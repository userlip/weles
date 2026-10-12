import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { checkReachable } from '../../_shared/action-runner.mjs';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';

// Which subreddit the account joins is the caller's; none is chosen here.
const SUBREDDIT = statedText(['SUBREDDIT'], 'the subreddit to join').replace(
  /^r\//,
  '',
);

const acct = await getSocialAccount('reddit');
if (!acct) {
  console.log('FAIL: no active reddit account');
  process.exit(1);
}
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'reddit_join_sub',
  proxy: proxyUrl,
  persona,
});
const _stored = (acct.metadata?.cookies ?? []).filter((c) =>
  /reddit\.com/.test(c.domain ?? ''),
);
// A jar that could not be injected leaves the session signed out; the
// failure is raised inside the try so it is reported and the session closed.
let cookieInjectError = null;
if (_stored.length)
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
  // Use old.reddit.com — the subscribe toggle is a plain anchor with stable
  // class-based state markers (.fancy-toggle-button.add → .remove on join)
  // rather than the new-reddit Header SDK which is driven through the
  // shadow DOM of <faceplate-tracker> / shreddit web components.
  await s.goto(`https://old.reddit.com/r/${encodeURIComponent(SUBREDDIT)}/`);
  checkReachable(s, 'reddit');
  try {
    await assertAuthed('reddit', s, { label: 'reddit_join_sub' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }
  // Real structure on old.reddit /r/<sub>/:
  //   <span class="fancy-toggle-button subscribe-button toggle">
  //     <a class="option active add login-required">join</a>  (visible when NOT subscribed)
  //     <a class="option remove">leave</a>                     (visible AFTER subscribe)
  //   </span>
  // The previous selectors used `a.fancy-toggle-button.add/remove` which match
  // nothing — fancy-toggle-button is on the parent span, not the <a>.
  const joinSelector = 'span.fancy-toggle-button.subscribe-button a.option.add';
  const leaveSelector =
    'span.fancy-toggle-button.subscribe-button a.option.remove.active';
  if (
    await s.page
      .locator(leaveSelector)
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    ban = await banSignalOf(
      detectRedditBanSignals,
      s,
      'after finding it joined',
    );
    console.log(
      `[ban-signal] ${ban?.signal}  PASS: already joined r/${SUBREDDIT}`,
    );
  } else {
    const joinBtn = s.page.locator(joinSelector).first();
    await joinBtn.waitFor({ state: 'visible' });
    await joinBtn.scrollIntoViewIfNeeded();
    await humanClickLocator(s.page, joinBtn);
    // Reddit's toggle() flips classes on success: <a.add> loses 'active' and
    // gains 'hidden' (or similar), <a.remove> gains 'active'. Wait for the
    // remove option to become active.
    await s.page.locator(leaveSelector).first().waitFor({ state: 'visible' });
    ban = await banSignalOf(detectRedditBanSignals, s, 'after joining');
    console.log(`[ban-signal] ${ban?.signal}  PASS: joined r/${SUBREDDIT}`);
  }
} catch (e) {
  ban =
    e.banSignal ??
    (await banSignalOf(detectRedditBanSignals, s, 'after the failure'));
  console.log(`[ban-signal] ${ban?.signal}  FAIL: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (ban) {
    try {
      const dir = runRecordingsDir('reddit_join_sub');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'ban_signal.json'),
        JSON.stringify(
          {
            account_id: acct.id,
            username: acct.username,
            action: 'reddit_join_sub',
            subreddit: SUBREDDIT,
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
