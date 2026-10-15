import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../../_shared/auth/cookie-freshness.mjs';
import { markCookiesStale } from '../../../../dist/utils/credentials.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

const TIKTOK_ORIGIN = 'https://www.tiktok.com';
// What to like is the caller's: a video in TARGET_URL, the first video of the
// profile in TARGET_USER, or the first video of the hashtag in SEARCH_QUERY.
// With none of them the run is refused rather than liking whatever the For
// You feed shows first.
const TARGET_URL = process.env.TARGET_URL?.trim();
const TARGET_USER = process.env.TARGET_USER?.trim().replace(/^@/, '');
const SEARCH_QUERY = process.env.SEARCH_QUERY?.trim().replace(/^#/, '');
const targetPage = TARGET_URL
  ? TARGET_URL
  : TARGET_USER
    ? `${TIKTOK_ORIGIN}/@${encodeURIComponent(TARGET_USER)}`
    : SEARCH_QUERY
      ? `${TIKTOK_ORIGIN}/tag/${encodeURIComponent(SEARCH_QUERY)}`
      : undefined;
if (!targetPage)
  throw new Error(
    'TIKTOK_LIKE_TARGET_REQUIRED: none of TARGET_URL, TARGET_USER or SEARCH_QUERY names what to like; nothing is assumed',
  );

const acct = await getSocialAccount('tiktok');
if (!acct) throw new Error('no active tiktok account to like with');
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'tiktok_like',
  proxy: proxyUrl,
  persona,
});
// Cookie freshness gate — see _shared/auth/cookie-freshness.mjs. Only the
// cookies TikTok's host would be sent are injected.
const tiktokHost = new URL(TIKTOK_ORIGIN).hostname;
let stored;
try {
  const freshJar = loadFreshCookieJarOrFail(acct, {
    platform: 'tiktok',
    label: 'tiktok_like',
    currentProxyUrl: proxyUrl,
    currentPersona: persona,
  });
  stored = freshJar.filter((c) => {
    if (typeof c.domain !== 'string') return false;
    const domain = c.domain.replace(/^\./, '');
    return tiktokHost === domain || tiktokHost.endsWith(`.${domain}`);
  });
  if (!stored.length)
    throw new CookieJarStaleError(
      'cookie_jar_no_domain_match: jar fresh but no tiktok.com cookies',
      { platform: 'tiktok' },
    );
} catch (jarErr) {
  if (jarErr instanceof CookieJarStaleError) {
    await markCookiesStale(acct.id);
    await s.close();
  }
  throw jarErr;
}
// A jar that could not be injected leaves the session signed out; the
// failure is raised inside the try so it is reported and the session closed.
let cookieInjectError = null;
await s.ctx.addCookies(stored).catch((e) => {
  cookieInjectError = e;
});
let ban = null;
try {
  if (cookieInjectError)
    throw new Error(
      `stored cookies could not be injected: ${cookieInjectError.message}`,
    );
  await s.goto(targetPage);
  checkReachable(s, 'tiktok');
  await humanIdlePause('deliberate');
  try {
    await assertAuthed('tiktok', s, { label: 'tiktok_like' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }
  // A profile or hashtag grid opens its first video; a video URL already
  // shows the action panel in place.
  if (!/\/video\//.test(s.page.url())) {
    const firstVideo = s.page.locator('a[href*="/video/"]').first();
    await firstVideo.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, firstVideo);
    await s.page.waitForURL(/\/video\/\d+/);
  }
  // Like button on TikTok video pages: data-e2e="like-icon" (foryou rail) or
  // "browse-like-icon" (profile-derived video page). Either match works.
  const likeBtn = s.page
    .locator(
      'button[data-e2e="like-icon"], button[data-e2e="browse-like-icon"], button:has([data-e2e="like-icon"]), button:has([data-e2e="browse-like-icon"])',
    )
    .filter({ visible: true })
    .first();
  await likeBtn.waitFor({ state: 'visible' });
  await likeBtn.scrollIntoViewIfNeeded();
  if ((await likeBtn.getAttribute('aria-pressed')) === 'true') {
    ban = await banSignalOf(
      detectTikTokBanSignals,
      s,
      'after finding it liked',
    );
    console.log(`[ban-signal] ${ban?.signal}  PASS: already liked`);
  } else {
    await humanClickLocator(s.page, likeBtn);
    // The like is confirmed when TikTok flips aria-pressed after its own
    // request answers.
    await s.page.waitForFunction(
      (el) => el?.getAttribute('aria-pressed') === 'true',
      await likeBtn.elementHandle(),
    );
    ban = await banSignalOf(detectTikTokBanSignals, s, 'after liking');
    console.log(`[ban-signal] ${ban?.signal}  PASS: liked`);
  }
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectTikTokBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  throw e;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('tiktok_like');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'tiktok_like',
            target_url: TARGET_URL,
            target_user: TARGET_USER,
            search_query: SEARCH_QUERY,
            liked_url: s.page.url(),
            ...ban,
            ts: new Date().toISOString(),
          },
          null,
          '  ',
        ),
      );
    } catch (e) {
      console.log('[ban-signal] persist err:', e.message);
    }
  }
  await s.close();
}
