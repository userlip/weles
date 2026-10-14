import { WSession } from '../../../dist/session/wsession.js';
import { markCookiesStale } from '../../../dist/utils/credentials.js';
import { assertAuthed, AuthProbeError } from '../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../_shared/auth/cookie-freshness.mjs';
import { loginViaTwitter } from './_session.mjs';
import { listAccounts } from '../_shared/skarbiec/accounts.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';

// Upvote the Product Hunt product PRODUCTHUNT_URL names
// (https://www.producthunt.com/products/<slug>); nothing is upvoted by default.

const TARGET_URL = statedText(
  ['PRODUCTHUNT_URL'],
  'the Product Hunt product page to upvote',
);
const proxy = process.env.PROXY_URL || 'none';
import { pageSettled } from '../_shared/page/settled.mjs';

async function findProductHuntAccount() {
  const rows = listAccounts('producthunt');
  return (
    rows.find(
      (account) =>
        Array.isArray(account.metadata?.cookies) &&
        account.metadata.cookies.length >= 1,
    ) ??
    rows[0] ??
    null
  );
}

async function injectPHCookies(s, cookies) {
  const normalized = cookies
    .filter((c) => c.name && c.value)
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain?.includes('producthunt.com')
        ? c.domain
        : '.producthunt.com',
      path: c.path || '/',
      secure: c.secure ?? true,
      httpOnly: c.httpOnly ?? false,
      sameSite: c.sameSite || 'Lax',
      ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
    }));
  await s.ctx.addCookies(normalized);
  console.log(`[ph-vote] injected ${normalized.length} producthunt cookies`);
}

// The whole page text: a state named past an invented cut was never seen.
async function readPage(s) {
  return (await s.page.locator('body').innerText()).toLowerCase();
}

async function findVoteButton(s) {
  // PH has two distinct vote button shapes:
  //   * data-test="vote-button"            — inline launch leaderboard (clickable, increments)
  //   * data-test="action-bar-vote-button" — product hub (one per historical launch, navigates)
  // Prefer the launch leaderboard button. Skip product-hub buttons (text "Upvote (N)").
  return await s.page
    .evaluate(`(() => {
    function rect(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height } : null; }
    var preferred = [
      'button[data-test="vote-button"]',
      'button[data-test*="vote-button"]:not([data-test*="action-bar"]):not([data-test*="thread"])',
      'button[aria-label*="Upvote" i]',
      'button[aria-label*="Vote" i]',
    ];
    for (var sel of preferred) {
      var b = document.querySelector(sel);
      if (b) { var r = rect(b); if (r) return { ...r, sel: sel, label: b.getAttribute('aria-label') ?? b.textContent }; }
    }
    // Last resort: action-bar (product hub — won't increment but at least confirms we found something)
    var ab = document.querySelector('button[data-test="action-bar-vote-button"]');
    if (ab) { var r2 = rect(ab); if (r2) return { ...r2, sel: 'action-bar-vote-button', label: ab.textContent }; }
    return null;
  })()`)
    .catch(() => null);
}

async function readVoteState(s) {
  return await s.page
    .evaluate(`(() => {
    var b = document.querySelector('button[data-test="vote-button"], button[aria-label*="Upvote" i], button[aria-label*="Vote" i], button[data-test="action-bar-vote-button"]');
    if (!b) return null;
    return {
      pressed: b.getAttribute('aria-pressed'),
      label: b.getAttribute('aria-label') || b.getAttribute('area-label'),
      text: b.textContent.replace(/\\s+/g, ' '),
      // Capture the count number from the text so we can compare even if button stays visually identical
      count: ((b.textContent || '').match(/\\d+/) || [null])[0],
    };
  })()`)
    .catch(() => null);
}

async function vote(s) {
  const acct = await findProductHuntAccount();
  if (!acct) throw new Error('no_producthunt_account_in_db');

  // Cookie-jar freshness gate — see _shared/auth/cookie-freshness.mjs. On stale,
  // skip injection and route through loginViaTwitter SSO recovery, matching
  // the same recovery shape profile.mjs and comment.mjs already use.
  let cookies = [];
  try {
    cookies = loadFreshCookieJarOrFail(acct, {
      platform: 'producthunt',
      label: 'producthunt_upvote',
      currentProxyUrl: proxy === 'none' ? null : proxy,
      currentPersona: acct.metadata?.persona,
    });
  } catch (jarErr) {
    if (!(jarErr instanceof CookieJarStaleError)) throw jarErr;
    console.log(`[ph-vote] ${jarErr.message} — invoking SSO recovery`);
    cookies = [];
  }
  console.log(
    `[ph-vote] using account: ${acct.username} (${cookies.length} cookies)`,
  );
  if (cookies.length) {
    await injectPHCookies(s, cookies);
  } else {
    console.log('[ph-vote] no fresh cookies — invoking loginViaTwitter');
    try {
      await loginViaTwitter(s);
    } catch (e) {
      // A jar that could not be marked stale is picked again by the next
      // run; the failure says so beside the sign-in's own cause.
      const marked = await markCookiesStale(acct.id).then(
        () => '',
        (markError) =>
          `; the cookie jar was not marked stale: ${markError.message}`,
      );
      throw new Error(`sso_recovery_failed: ${e.message}${marked}`);
    }
  }
  // PH's homepage SSR cache sometimes serves the logged-out shell to a
  // freshly-SSO'd session, so the sign-in is probed on the requested product
  // page itself, which renders the authed topbar avatar; the vote then loads
  // it again with a ?bc=1 cache-buster.
  await s.goto(TARGET_URL);
  await pageSettled(s.page);
  try {
    await assertAuthed('producthunt', s, { label: 'producthunt_upvote' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) {
      throw new Error(`auth_probe_failed: ${probeErr.message}`);
    }
    throw probeErr;
  }
  const cacheBustedHome = TARGET_URL.includes('?')
    ? `${TARGET_URL}&bc=1`
    : `${TARGET_URL}?bc=1`;
  await s.goto(cacheBustedHome);
  await pageSettled(s.page);

  // A cookie notice is recognised and closed by the vision model, not by the
  // words 'cookies' anywhere in the page.
  await clickOffered(s.page, 'the button that accepts or closes the cookie notice');
  await pageSettled(s.page);

  // A launch page carries the inline vote button (data-test="vote-button")
  // that records a vote; a product hub (/products/<slug>) carries only the
  // action-bar button, which navigates away. A requested launch that
  // redirected to its hub is refused, never answered by a vote elsewhere.
  const cur = s.page.url();
  if (cur.includes('/products/') && !TARGET_URL.includes('/products/'))
    throw new Error(
      `launch_page_unavailable: ${TARGET_URL} redirected to the product hub ${cur}, which records no launch vote; nothing was voted`,
    );

  const beforeState = await readVoteState(s);
  console.log(`[ph-vote] before: ${JSON.stringify(beforeState)}`);

  let btn = await findVoteButton(s);
  if (!btn) throw new Error('vote_button_not_found');
  console.log(
    `[ph-vote] vote button found: ${btn.sel} label="${btn.label}" at (${Math.round(btn.x)},${Math.round(btn.y)})`,
  );

  // Scroll button into view, then re-measure (post-scroll viewport coords differ)
  await s.page
    .evaluate(`(() => {
    var b = document.querySelector('button[data-test*="vote"], button[aria-label*="Upvote" i], button[aria-label*="Vote" i], button[data-sentry-component*="VoteButton" i]');
    if (b) b.scrollIntoView({ block: 'center', behavior: 'instant' });
  })()`)
    .catch(() => {});
  await pageSettled(s.page);
  btn = await findVoteButton(s);
  if (!btn) throw new Error('vote_button_lost_after_scroll');
  console.log(
    `[ph-vote] post-scroll coords: (${Math.round(btn.x)},${Math.round(btn.y)})`,
  );

  // mouse.click routes through CDP → SetTrusted(true) — required for PH's vote handler
  await s.page.mouse.click(btn.x, btn.y).catch(() => {});
  await pageSettled(s.page);

  const afterState = await readVoteState(s);
  console.log(`[ph-vote] after: ${JSON.stringify(afterState)}`);

  const flipped =
    beforeState &&
    afterState &&
    (beforeState.pressed !== afterState.pressed ||
      beforeState.label !== afterState.label ||
      (beforeState.count || '') !== (afterState.count || '') ||
      (beforeState.text || '') !== (afterState.text || ''));
  if (!flipped) {
    const url = s.page.url();
    if (url.includes('/login') || url.includes('/sign-in'))
      throw new Error('redirected_to_login');
    throw new Error(`vote_state_unchanged: ${JSON.stringify(afterState)}`);
  }

  console.log(`[ph-vote] vote registered`);
  return acct.username;
}

// This trajectory uses the Chromium navigation and input path.
const s = await WSession.start({
  label: 'producthunt_upvote',
  proxy,
  browser: 'chromium',
});
try {
  const username = await vote(s);
  console.log(`PASS: ${username} upvoted ${TARGET_URL}`);
  await s.close();
  process.exit(0);
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
  process.exit(1);
}
