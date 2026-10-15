/**
 * Reddit organic browse — reads the declared origin, scrolls, exits.
 * Lowest-friction observation in the warming/mature/active menu. No clicks.
 *
 * The origin and the dwell budget are declaration content: admission resolved
 * reddit.browse and its {subreddit} before this process existed, so nothing
 * here names a URL or a scroll count. Uses the account's stored persona +
 * proxy via resolveAccountSession. The account's verdict after the browse is
 * read through the shared ban-signal reader and kept in the run's
 * ban_signal.json by the shared verdict writer (`../../../_shared/action`).
 */
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../../dist/utils/credentials.js';
import { WSession } from '../../../../../dist/session/wsession.js';
import { detectRedditBanSignals } from '../../../../../dist/platforms/reddit/ban_signals.js';
import { banSignalOf } from '../../../_shared/auth/ban-signal.mjs';
import {
  humanIdlePause,
  humanScrollPage,
} from '../../../../../dist/human/mouse.js';
import { declaredObservation } from '../../../_shared/observation.mjs';
import { keepVerdict } from '../../../_shared/action/verdict.mjs';

const LABEL = 'reddit_browse';
const observed = declaredObservation();

const acct = await getSocialAccount('reddit');
if (!acct) throw new Error('no active reddit account to browse with');
console.log(`[browse] acct=${acct.username} origin=${observed.origin}`);

const run = {
  observation: observed.observation,
  origin: observed.origin,
  reads: observed.reads,
};
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: LABEL,
  proxy: proxyUrl,
  persona,
});
try {
  await s.goto(observed.origin);
  // Idle scroll: simulate skimming the feed without clicking anything, for
  // exactly as long as the declared dwell budget allows.
  for (const step of Array(observed.scrolls).keys()) {
    await humanScrollPage(s.page, 'down');
    await humanIdlePause(observed.dwellMs);
    console.log(`[browse] scrolled after ${step} earlier scrolls`);
  }
  const banSignal = await banSignalOf(detectRedditBanSignals, s, 'after browsing');
  console.log(`[ban-signal] ${banSignal.signal}`);
  if (!banSignal.healthy)
    throw Object.assign(
      new Error(`the page reads ${banSignal.signal} after browsing`),
      { banSignal },
    );
  await keepVerdict(LABEL, acct, banSignal, run);
  console.log(`PASS: scrolled ${observed.scrolls}x on ${observed.origin}`);
} catch (e) {
  const banSignal = e.banSignal
    ? e.banSignal
    : await banSignalOf(detectRedditBanSignals, s, 'after the failure');
  console.log(`[ban-signal] ${banSignal.signal}  FAIL: ${e.message}`);
  try {
    await keepVerdict(LABEL, acct, banSignal, run);
  } catch (writeError) {
    throw new AggregateError(
      [e, writeError],
      `${e.message}; and its ban signal was not kept: ${writeError.message}`,
    );
  }
  throw e;
} finally {
  await s.close();
}
