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
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';

// The post to like is the caller's; without TARGET_URL the run is refused
// rather than liking the home timeline's first post or another account's.
const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the X post to like',
  'TWITTER_LIKE_TARGET_REQUIRED',
);

const acct = await getSocialAccount('twitter');
if (!acct) throw new Error('no active twitter account to like with');
console.log(`[trajectory] Using account: ${acct.username}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'twitter_like',
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
      label: 'twitter_like',
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

  await s.page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('deliberate');
  const url = s.page.url();
  if (/\/i\/flow\/login/.test(url)) {
    await markCookiesStale(acct.id);
    throw new Error(`cookies stale, redirected to login (${url})`);
  }

  // Positive auth probe — auth_token in jar ≠ session is real. Twitter
  // serves a logged-out shell for cookie-injected sessions it doesn't trust.
  // URL doesn't bounce, but compose / DM / profile links are absent. See
  // _shared/auth/auth-probe.mjs.
  try {
    await assertAuthed('twitter', s, { label: 'twitter_like' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }
  await pageSettled(s.page);
  // A post's page can show the posts it answers above it and replies below;
  // the post itself is the article whose timestamp links to its own status
  // id, and only its control is touched.
  const statusId = new URL(TARGET_URL).pathname.match(/\/status\/(?<id>\d+)/)
    ?.groups.id;
  if (!statusId)
    throw new Error(`TARGET_URL ${TARGET_URL} is not an X post address`);
  const post = s.page
    .locator('article[data-testid="tweet"]')
    .filter({ has: s.page.locator(`a[href$="/status/${statusId}"] time`) })
    .first();
  await post.waitFor({ state: 'visible' });
  const likeBtn = post.locator('[data-testid="like"]');
  const unlikeBtn = post.locator('[data-testid="unlike"]');
  if (await unlikeBtn.isVisible()) {
    console.log(`PASS: ${TARGET_URL} is already liked`);
  } else {
    if (!(await likeBtn.isVisible()))
      throw new Error(`${TARGET_URL} shows no like control on its post`);
    await likeBtn.scrollIntoViewIfNeeded();
    await humanClickLocator(s.page, likeBtn);
    // The like is taken when the same control turns into data-testid="unlike".
    await unlikeBtn.waitFor({ state: 'visible' }).catch((error) => {
      throw new Error(
        `clicked like on ${TARGET_URL} but the control never turned to unlike: ${error.message}`,
        { cause: error },
      );
    });
    console.log(`PASS: liked ${TARGET_URL}`);
  }
} catch (e) {
  console.log('FAIL:', e.message);
  throw e;
} finally {
  await s.close();
}
