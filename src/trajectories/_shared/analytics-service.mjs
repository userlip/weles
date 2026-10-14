import { WSession } from '../../../dist/session/wsession.js';
import { SessionStore } from '../../../dist/session/store.js';
import {
  ACTIONS,
  actionName,
  missingInputs,
} from './analytics-service/action-catalog.mjs';
import { safeGoto } from './analytics-service/page-interaction.mjs';
import { ensureLoggedIn } from './analytics-service/session-login.mjs';
import { humanScrollPage } from '../../../dist/human/mouse.js';
import { pageSettled } from './page/settled.mjs';
import { statedProxy } from './inputs/stated.mjs';
import {
  resolvedUrl,
  openExpectedDashboardSection,
} from './analytics-service/google-analytics/reports.mjs';
import {
  prepareWrite,
  performConfirmedWrite,
  verifyTargetSite,
  captureEvidence,
  assertExpectedEvidence,
  writeBanSignal,
} from './analytics-service/evidence.mjs';

async function run() {
  const name = actionName();
  const cfg = ACTIONS[name];
  if (!cfg) throw new Error(`unsupported analytics service action: ${name}`);

  const missing = missingInputs(cfg);
  if (missing.length)
    throw new Error(`missing required input(s): ${missing.join(', ')}`);

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

    const pending = cfg.changesState && (await prepareWrite(s, cfg));
    if (pending) {
      await safeGoto(s, resolvedUrl(cfg));
      await captureEvidence(s, cfg, { pending_review: true });
      writeBanSignal('pending_review', true, {
        risk: cfg.risk,
        reason: 'write/admin action staged for approval',
      });
      console.log(`PASS: ${name} pending_review`);
      return;
    }

    let extra = {};
    const { opening } = cfg;
    if (opening.targetSite) extra.targetSite = await verifyTargetSite(s, cfg);
    if (opening.dashboard) {
      await safeGoto(s, resolvedUrl(cfg));
      await pageSettled(s.page);
      if (cfg.platform === 'googleanalytics')
        await openExpectedDashboardSection(s);
    }
    if (opening.interacts) {
      if (cfg.scrolls) await humanScrollPage(s.page, 'down');
      if (cfg.changesState)
        extra = { ...extra, ...(await performConfirmedWrite(s, cfg)) };
    }

    const evidence = await captureEvidence(s, cfg, extra);
    assertExpectedEvidence(evidence);
    writeBanSignal('healthy', true, {
      final_url: evidence.url,
      evidence_file: 'service_action_result.json',
    });
    console.log(`PASS: ${name} ${cfg.objective}`);
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

run()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    writeBanSignal('service_action_failed', false, {
      reason: e.message ?? String(e),
    });
    console.log('FAIL:', e.message);
    process.exit(1);
  });
