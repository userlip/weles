import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import { detectTwitterBanSignals } from '../../../../dist/platforms/twitter/ban_signals.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

// The post to bookmark is the caller's; without it the run is refused rather
// than bookmarking whatever the home timeline shows first.
const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the X post to bookmark',
  'TWITTER_BOOKMARK_TARGET_REQUIRED',
);
const targetHost = new URL(TARGET_URL).hostname;

const acct = await getSocialAccount('twitter');
if (!acct)
  throw new Error('no active twitter account to bookmark with; nothing ran');
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'twitter_bookmark',
  proxy: proxyUrl,
  persona,
});
// The account's stored jar, limited to the cookies the target's host would
// be sent (its own domain or a parent domain on a label boundary); an
// account with no stored jar has none to inject.
const storedJar = Array.isArray(acct.metadata?.cookies)
  ? acct.metadata.cookies
  : [];
const targetCookies = storedJar.filter((c) => {
  if (typeof c.domain !== 'string') return false;
  const domain = c.domain.replace(/^\./, '');
  return targetHost === domain || targetHost.endsWith(`.${domain}`);
});
// A jar that could not be injected leaves the session signed out; the
// failure is raised inside the try so it is reported and the session closed.
let cookieInjectError = null;
if (targetCookies.length)
  await s.ctx.addCookies(targetCookies).catch((e) => {
    cookieInjectError = e;
  });
let ban = null;
try {
  if (cookieInjectError)
    throw new Error(
      `stored cookies could not be injected: ${cookieInjectError.message}`,
    );
  await s.goto(TARGET_URL);
  checkReachable(s, 'twitter');
  await humanIdlePause('deliberate');
  // Deterministic: data-testid="bookmark" is the un-bookmarked state;
  // post-click the same testid flips to "removeBookmark".
  const bookmarkBtn = s.page
    .locator('[data-testid="bookmark"]')
    .filter({ visible: true })
    .first();
  await bookmarkBtn.waitFor({ state: 'visible' });
  await bookmarkBtn.scrollIntoViewIfNeeded();
  await humanClickLocator(s.page, bookmarkBtn);
  await s.page
    .locator('[data-testid="removeBookmark"]')
    .first()
    .waitFor({ state: 'visible' });
  ban = await banSignalOf(detectTwitterBanSignals, s, 'after the bookmark');
  console.log(`[ban-signal] ${ban?.signal}  PASS: bookmarked`);
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectTwitterBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  throw e;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('twitter_bookmark');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'twitter_bookmark',
            target_url: TARGET_URL,
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
