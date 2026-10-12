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
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';

// Who the account follows is the caller's; no account is followed by default.
const TARGET_USER = statedText(
  ['TARGET_USER'],
  'the Instagram account to follow',
).replace(/^@/, '');
const URL = `https://www.instagram.com/${encodeURIComponent(TARGET_USER)}/`;

const acct = await getSocialAccount('instagram');
if (!acct) {
  console.log('FAIL: no active instagram account in DB');
  process.exitCode = 1;
}
console.log(`[trajectory] Using account: ${acct.username}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'instagram_follow',
  proxy: proxyUrl,
  persona,
});

try {
  // Cookie freshness gate — see _shared/auth/cookie-freshness.mjs.
  let stored;
  try {
    const all = loadFreshCookieJarOrFail(acct, {
      platform: 'instagram',
      label: 'instagram_follow',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    stored = all.filter((c) => /instagram\.com/.test(c.domain ?? ''));
    if (!stored.length)
      throw new CookieJarStaleError(
        'cookie_jar_no_domain_match: jar fresh but no instagram.com cookies',
        { platform: 'instagram' },
      );
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx.addCookies(stored.map((c) => ({ ...c, path: c.path || '/' })));

  await s.page.goto(URL, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('long');
  const url = s.page.url();
  if (/\/accounts\/login/.test(url)) {
    await markCookiesStale(acct.id);
    throw new Error(`cookies stale, redirected to login (${url})`);
  }
  // Positive auth probe — see _shared/auth/auth-probe.mjs.
  try {
    await assertAuthed('instagram', s, { label: 'instagram_follow' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }

  // The Follow button on a profile page is rendered as <button>Follow</button>
  // inside the profile header. After click it becomes <button>Following</button>
  // — verify the text-state transition. If already following, exit healthy.
  const followBtn = s.page
    .locator('button')
    .filter({ hasText: /^\s*Follow\s*$/ })
    .filter({ visible: true })
    .first();
  const followingBtn = s.page
    .locator('button')
    .filter({ hasText: /^\s*Following\s*$/ })
    .filter({ visible: true })
    .first();
  const alreadyFollowing = await followingBtn.count().catch(() => 0);
  if (alreadyFollowing > 0) {
    console.log(`PASS: already following @${TARGET_USER}`);
  } else {
    await followBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, followBtn);
    await humanIdlePause('deliberate');
    // Verify transition: Follow → Following
    const after = await s.page
      .locator('button')
      .filter({ hasText: /^\s*Following\s*$/ })
      .filter({ visible: true })
      .count()
      .catch(() => 0);
    if (after === 0)
      throw new Error(
        'clicked Follow but no transition to Following — may be shadowbanned or rate-limited',
      );
    console.log(`PASS: followed @${TARGET_USER}`);
  }
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
