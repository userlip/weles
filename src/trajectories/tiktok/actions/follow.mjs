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

// When TARGET_USER is unset, default to TikTok's official account — gives a
// deterministic, always-populated profile page rather than relying on the
// /foryou feed's per-session creator selection.
const TARGET_USER = (process.env.TARGET_USER || 'tiktok').replace(/^@/, '');

const acct = await getSocialAccount('tiktok');
if (!acct) {
  console.log('FAIL: no active tiktok account');
  process.exit(1);
}
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'tiktok_follow',
  proxy: proxyUrl,
  persona,
});
// Cookie freshness gate — see _shared/auth/cookie-freshness.mjs.
let _stored;
try {
  const _all = loadFreshCookieJarOrFail(acct, {
    platform: 'tiktok',
    label: 'tiktok_follow',
    currentProxyUrl: proxyUrl,
    currentPersona: persona,
  });
  _stored = _all.filter((c) => /tiktok\.com/.test(c.domain ?? ''));
  if (!_stored.length)
    throw new CookieJarStaleError(
      'cookie_jar_no_domain_match: jar fresh but no tiktok.com cookies',
      { platform: 'tiktok' },
    );
} catch (jarErr) {
  if (jarErr instanceof CookieJarStaleError) {
    console.log(`FAIL: ${jarErr.message}`);
    await markCookiesStale(acct.id);
    await s
      .close()
      .catch((e) => console.log(`[session] close failed: ${e.message}`));
    process.exit(1);
  }
  throw jarErr;
}
// A jar that could not be injected leaves the session signed out; the
// failure is raised inside the try so it is reported and the session closed.
let cookieInjectError = null;
await s.ctx
  .addCookies(_stored.map((c) => ({ ...c, path: c.path || '/' })))
  .catch((e) => {
    cookieInjectError = e;
  });
let ban = null;
try {
  if (cookieInjectError)
    throw new Error(
      `stored cookies could not be injected: ${cookieInjectError.message}`,
    );
  await s.goto(`https://www.tiktok.com/@${encodeURIComponent(TARGET_USER)}`);
  checkReachable(s, 'tiktok');
  await humanIdlePause('deliberate');
  // Positive auth probe — cookies in jar ≠ TikTok server trusts session.
  // See _shared/auth/auth-probe.mjs.
  try {
    await assertAuthed('tiktok', s, { label: 'tiktok_follow' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }
  // Idempotent: if already following, exit clean.
  const followingBtn = s.page
    .locator('button[data-e2e="follow-icon"], button:has-text("Following")')
    .filter({ visible: true })
    .first();
  if ((await followingBtn.count().catch(() => 0)) > 0) {
    ban = await banSignalOf(
      detectTikTokBanSignals,
      s,
      'after finding it followed',
    );
    console.log(
      `[ban-signal] ${ban?.signal}  PASS: already following @${TARGET_USER}`,
    );
  } else {
    // Profile page Follow button: data-e2e="follow-button" on web; after
    // a successful follow it switches to data-e2e="follow-icon" (Following).
    const followBtn = s.page
      .locator('button[data-e2e="follow-button"]')
      .filter({ visible: true })
      .first();
    await followBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, followBtn);
    await followingBtn.waitFor({ state: 'visible' });
    ban = await banSignalOf(detectTikTokBanSignals, s, 'after following');
    console.log(`[ban-signal] ${ban?.signal}  PASS: followed @${TARGET_USER}`);
  }
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectTikTokBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('tiktok_follow');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'tiktok_follow',
            target_user: TARGET_USER,
            ...ban,
            ts: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      console.log('[ban-signal] persist err:', e.message);
    }
  }
  await s.close();
}
