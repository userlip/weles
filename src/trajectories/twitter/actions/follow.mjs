import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import { urlMatching } from '../../_shared/page/settled.mjs';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';

// Whom to follow is the caller's; without TARGET_USER the run is refused
// rather than following an account written into the code.
const TARGET_HANDLE = statedText(
  ['TARGET_USER'],
  'the X account to follow',
  'TWITTER_FOLLOW_TARGET_REQUIRED',
).replace(/^@/, '');
if (!TARGET_HANDLE)
  throw new Error('TARGET_USER is "@" alone: it names no X account');
const TARGET_URL = `https://x.com/${encodeURIComponent(TARGET_HANDLE)}`;

const acct = await getSocialAccount('twitter');
if (!acct) throw new Error('no active twitter account to follow with');
console.log(`[trajectory] Using account: ${acct.username}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'twitter_follow',
  proxy: proxyUrl,
  persona,
});

try {
  // Cookie freshness gate — see _shared/auth/cookie-freshness.mjs. A cookie
  // Playwright cannot set (no name, value, domain or url) is left out; the
  // ones it can set keep their own path.
  let prepared;
  try {
    const all = loadFreshCookieJarOrFail(acct, {
      platform: 'twitter',
      label: 'twitter_follow',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    const hasAuthToken = all.some((c) => c?.name === 'auth_token' && c?.value);
    if (!hasAuthToken)
      throw new CookieJarStaleError(
        'cookie_jar_missing_auth_token: jar fresh but no auth_token',
        { platform: 'twitter' },
      );
    prepared = all.filter((c) => c?.name && c?.value && (c.domain || c.url));
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx.addCookies(prepared);
  console.log(
    `[trajectory] injected ${prepared.length} stored cookies (jar fresh)`,
  );

  await s.page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  // x.com SPA hydrates the profile page after domcontentloaded; the Follow /
  // Following button for the target (either state, so an account that already
  // follows still passes) or the login redirect ends the wait — whichever the
  // page shows first. Buttons are scoped to the target through their
  // aria-label so a sidebar "Who to follow" suggestion never matches.
  const followBtn = s.page
    .locator(`[data-testid$="-follow"][aria-label*="${TARGET_HANDLE}"]`)
    .first();
  const unfollowBtn = s.page
    .locator(`[data-testid$="-unfollow"][aria-label*="${TARGET_HANDLE}"]`)
    .first();
  await Promise.any([
    followBtn.or(unfollowBtn).first().waitFor({ state: 'visible' }),
    urlMatching(s.page, /\/i\/flow\/login/),
  ]).catch((failure) => {
    throw new Error(
      `${TARGET_URL} showed neither a Follow nor a Following control for @${TARGET_HANDLE}, nor the login page`,
      { cause: failure },
    );
  });
  const url = s.page.url();
  if (/\/i\/flow\/login/.test(url)) {
    await markCookiesStale(acct.id);
    throw new Error(`cookies stale, redirected to login (${url})`);
  }
  // Positive auth probe — see _shared/auth/auth-probe.mjs.
  try {
    await assertAuthed('twitter', s, { label: 'twitter_follow' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }

  // Already following? data-testid ends with -unfollow (the button label is
  // "Following" on hover and "Unfollow" on click).
  if (await unfollowBtn.isVisible()) {
    console.log(`PASS: already following @${TARGET_HANDLE}`);
  } else {
    await humanClickLocator(s.page, followBtn);
    await humanIdlePause('deliberate');
    // Verify Follow → Following transition (scoped to the target handle).
    if (!(await unfollowBtn.isVisible()))
      throw new Error(
        `clicked Follow on @${TARGET_HANDLE} but no Following state appeared at ${url}`,
      );
    console.log(`PASS: followed @${TARGET_HANDLE}`);
  }
} catch (e) {
  console.log('FAIL:', e.message);
  throw e;
} finally {
  await s.close();
}
