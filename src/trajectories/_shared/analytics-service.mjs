// One analytics service action (Umami, Google Analytics), as its catalog
// declares it (./analytics-service/catalog/<platform>.json): refused when a
// required input is missing; signed in when the action signs in; a write or
// admin action staged for approval until WRITE_CONFIRM=1; the target site
// and the dashboard opened as declared; its evidence kept and checked
// (./analytics-service/checks/expected.mjs). The outcome is kept as the
// run's verdict through the shared verdict writer; a failure is thrown.
import { WSession } from '../../../dist/session/wsession.js';
import { SessionStore } from '../../../dist/session/store.js';
import { ACTIONS, actionName, missingInputs } from './analytics-service/action-catalog.mjs';
import { safeGoto } from './analytics-service/page-interaction.mjs';
import { ensureLoggedIn } from './analytics-service/session-login.mjs';
import { humanScrollPage } from '../../../dist/human/mouse.js';
import { pageSettled } from './page/settled.mjs';
import { statedProxy } from './inputs/stated.mjs';
import { keepVerdict } from './action/verdict.mjs';
import { openExpectedDashboardSection } from './analytics-service/google-analytics/reports.mjs';
import {
  prepareWrite,
  performConfirmedWrite,
  verifyTargetSite,
  captureEvidence,
} from './analytics-service/evidence.mjs';
import { assertExpectedEvidence } from './analytics-service/checks/expected.mjs';

/** The action's run; answers the verdict it reached. */
async function run(name, cfg) {
  const s = await WSession.start({
    label: name,
    browser: 'chromium',
    proxy: statedProxy(`the ${name} analytics action`),
    os: 'macos',
  });
  const store = new SessionStore();
  let actionError = null;
  try {
    await store.injectPlaywright?.(s.ctx, cfg.platform);
    if (cfg.signsIn) {
      await ensureLoggedIn(s, cfg);
      await store.capturePlaywright?.(s.ctx, cfg.platform);
    }
    if (cfg.changesState && (await prepareWrite(s, cfg))) {
      await safeGoto(s, cfg.url());
      await captureEvidence(s, cfg, { pending_review: true });
      console.log(`PASS: ${name} pending_review`);
      return {
        signal: 'pending_review',
        healthy: true,
        details: { risk: cfg.risk, reason: 'write/admin action staged for approval' },
      };
    }
    let extra = {};
    const { opening } = cfg;
    if (opening.targetSite) extra.targetSite = await verifyTargetSite(s, cfg);
    if (opening.dashboard) {
      await safeGoto(s, cfg.url());
      await pageSettled(s.page);
      if (cfg.platform === 'googleanalytics') await openExpectedDashboardSection(s, cfg);
    }
    if (opening.interacts) {
      if (cfg.scrolls) await humanScrollPage(s.page, 'down');
      if (cfg.changesState) extra = { ...extra, ...(await performConfirmedWrite(s, cfg)) };
    }
    const evidence = await captureEvidence(s, cfg, extra);
    await assertExpectedEvidence(s, cfg, evidence);
    console.log(`PASS: ${name} ${cfg.objective}`);
    return {
      signal: 'healthy',
      healthy: true,
      details: { final_url: evidence.url, evidence_file: 'service_action_result.json' },
    };
  } catch (error) {
    actionError = error;
    throw error;
  } finally {
    try {
      await s.close();
    } catch (closeError) {
      if (!actionError) throw closeError;
      throw new Error(
        `${name} failed: ${actionError.message}; and the browser session was left open: ${closeError.message}`,
        { cause: actionError },
      );
    }
  }
}

const name = actionName();
const cfg = ACTIONS[name];
if (!cfg) throw new Error(`unsupported analytics service action: ${name}`);
const missing = missingInputs(cfg);
if (missing.length) throw new Error(`missing required input(s): ${missing.join(', ')}`);

let verdict;
let failure;
try {
  verdict = await run(name, cfg);
} catch (error) {
  failure = error;
  verdict = { signal: 'service_action_failed', healthy: false, details: { reason: error.message } };
  console.log('FAIL:', error.message);
}
try {
  await keepVerdict(name, null, verdict);
} catch (keepError) {
  failure = failure
    ? new AggregateError([failure, keepError], `${failure.message}; and its verdict was not kept: ${keepError.message}`)
    : keepError;
}
if (failure) throw failure;
