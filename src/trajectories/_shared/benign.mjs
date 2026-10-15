/**
 * The reviewed observation trajectory. One file reads a declared origin under
 * a declared dwell budget, on any platform that has a ban detector.
 *
 * src/worker/deploy/weles-observation-declaration.json says what a run reads
 * and for how long, admission resolves it before this process exists, and
 * this file spends exactly the budget it was given. Every run writes
 * recordings/<platform>_<verb>/ban_signal.json from the platform's ban
 * detector, read and kept by the shared action verdict
 * (`./action/verdict.mjs`), so the worker can detect silent bans. A run that
 * fails is thrown with its cause after its verdict is kept and its session
 * closed.
 */
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { detectRedditBanSignals } from '../../../dist/platforms/reddit/ban_signals.js';
import { detectTwitterBanSignals } from '../../../dist/platforms/twitter/ban_signals.js';
import { detectInstagramBanSignals } from '../../../dist/platforms/instagram/ban_signals.js';
import { detectTikTokBanSignals } from '../../../dist/platforms/tiktok/ban_signals.js';
import { detectLinkedInBanSignals } from '../../../dist/platforms/linkedin/ban_signals.js';
import { detectDiscordBanSignals } from '../../../dist/platforms/discord/ban_signals.js';
import { detectGitHubBanSignals } from '../../../dist/platforms/github/ban_signals.js';
import { detectProductHuntBanSignals } from '../../../dist/platforms/producthunt/ban_signals.js';
import { humanIdlePause } from '../../../dist/human/mouse.js';
import { declaredObservation } from './observation.mjs';
import { handleBrowse } from './runner/handlers.mjs';
import { checkReachable } from './action/reachable.mjs';
import {
  keepVerdict,
  verdictAfterAction,
  verdictAfterFailure,
} from './action/verdict.mjs';

const DETECTORS = {
  reddit: detectRedditBanSignals,
  twitter: detectTwitterBanSignals,
  instagram: detectInstagramBanSignals,
  tiktok: detectTikTokBanSignals,
  linkedin: detectLinkedInBanSignals,
  discord: detectDiscordBanSignals,
  github: detectGitHubBanSignals,
  producthunt: detectProductHuntBanSignals,
};

const observed = declaredObservation();
const PLATFORM = observed.platform;
const VERB = observed.verb;
if (!Object.hasOwn(DETECTORS, PLATFORM))
  throw new Error(
    `OBSERVATION_PLATFORM_UNSUPPORTED: no ban detector for ${PLATFORM}; one of ${Object.keys(DETECTORS).join(', ')}`,
  );
const cfg = {
  platform: PLATFORM,
  action: VERB,
  banDetector: DETECTORS[PLATFORM],
};
const label = `${PLATFORM}_${VERB}`;
const run = {
  observation: observed.observation,
  origin: observed.origin,
  reads: observed.reads,
};

let acct = null;
let s = null;
let banSignal = null;
let failure = null;
try {
  acct = await getSocialAccount(PLATFORM);
  if (!acct) {
    banSignal = {
      signal: 'no_account',
      healthy: false,
      details: {
        stage: 'pre-WSession',
        reason: `no active ${PLATFORM} account`,
      },
    };
    throw new Error(`OBSERVATION_ACCOUNT_REQUIRED: no active ${PLATFORM} account`);
  }
  console.log(
    `[benign] ${observed.observation} acct=${acct.username} reads=${observed.reads} origin=${observed.origin}`,
  );

  const { proxyUrl, persona } = await resolveAccountSession(acct);
  s = await WSession.start({ label, proxy: proxyUrl, persona });
  await s.goto(observed.origin);
  checkReachable(s, PLATFORM);
  // The declared dwell budget: `scrolls` bursts, each followed by an idle read
  // of the declared length. A budget of no scrolls still spends one idle read,
  // because a run that navigates and closes at once has not observed anything.
  const resultValue = await handleBrowse(s, {
    scrolls: observed.scrolls,
    dwellMs: observed.dwellMs,
  });
  if (!observed.scrolls) await humanIdlePause(observed.dwellMs);
  banSignal = await verdictAfterAction(s, cfg, resultValue);
  // A verdict that is not healthy after the loop is the run's outcome.
  if (banSignal && !banSignal.healthy)
    throw new Error(`the page reads ${banSignal.signal} after ${label}`);
  console.log(`[ban-signal] ${banSignal ? banSignal.signal : 'not read'}`);
  console.log(`PASS: ${label} ${resultValue}`);
} catch (error) {
  failure = error;
  // Before the session opened there is no page to read: the failure itself
  // is the verdict.
  banSignal = s
    ? await verdictAfterFailure(s, cfg, error, banSignal)
    : banSignal
      ? banSignal
      : {
          signal: 'session_boot_failed',
          healthy: false,
          details: { stage: 'pre-WSession', reason: error.message },
        };
  console.log(`[ban-signal] ${banSignal.signal}`);
  console.error('FAIL:', error.message);
} finally {
  try {
    if (banSignal) await keepVerdict(label, acct, banSignal, run);
  } catch (keepError) {
    // A run that already failed keeps its own cause; a passed run whose
    // verdict cannot be kept fails with this one.
    if (!failure) failure = keepError;
    console.error(
      `[ban-signal] the verdict could not be kept: ${keepError.message}`,
    );
  }
  if (s) await s.close();
}
if (failure) throw failure;
