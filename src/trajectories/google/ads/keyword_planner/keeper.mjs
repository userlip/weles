// Google Ads Keyword Planner through the persistent Weles keeper.
// Do not reimplement this path with REST/developer-credential access;
// keyword-volume collection for reports is intentionally UI-observed via Weles.
// No CUA. No CDP attach. No short-lived WSession/profile launch.
// The keeper owns the browser/profile; this runner drives it through the socket.
//
// Env:
//   GOOGLE_ADS_CUSTOMER_ID       required
//   GOOGLE_ADS_KEYWORDS          required, comma/newline separated
//   GOOGLE_ADS_RESULT_FILE       optional JSON output path
//   SESSION                      required keeper session (or GOOGLE_ADS_KEEPER_SESSION)
//   GOOGLE_ADS_AUTHUSER          required Google account index the customer is signed in as
//   Login identity/password/MFA are read only from the dedicated Google Ads Skarbiec item.
//
// Every run writes one record to the result file. A refusal (keeper not
// running, login without a password, sign-in or planner not reached, no
// result rows, or any error) is written with its `blocked` cause and then
// thrown, so the run fails with it.

import {
  SESSION,
  SOCK,
  cid,
  keywords,
  norm,
  preferredEmail,
  refuse,
  socketReady,
  ssoCreds,
  writeResult,
} from './keeper/run_brief.mjs';
import { evalState } from './keeper/keeper_browser.mjs';
import {
  chooseVolumeMode,
  ensureAdsReady,
  openKeywordPlanner,
  submitKeywords,
} from './keeper/planner_navigation.mjs';
import {
  parseRows,
  waitForResults,
  writeKeywordReport,
} from './keeper/metrics_report.mjs';

try {
  if (!socketReady())
    refuse({ blocked: 'keeper_socket_not_ready', socket: SOCK });
  const creds = ssoCreds();
  if (!creds.password)
    refuse({ blocked: 'missing_google_ads_password', email: preferredEmail() });
  const steps = [{ step: 'sso_creds_resolved', source: creds.source }];

  if (!(await ensureAdsReady(creds))) {
    const s = await evalState();
    refuse({
      blocked: 'google_ads_login_not_ready',
      url: s.url,
      text: norm(s.text),
    });
  }
  steps.push({ step: 'ads_ready', url: (await evalState()).url });

  const open = await openKeywordPlanner();
  steps.push({ step: 'planner_open', open });
  if (!open.ok)
    refuse({
      blocked: 'keyword_planner_not_opened',
      customer: cid,
      keywords,
      open,
      steps,
    });

  // Results this customer's planner already shows for the run's keywords are
  // the answer; otherwise the keywords are entered and submitted.
  const already = await evalState();
  const alreadyRows = parseRows(already.text);
  if (alreadyRows.length) {
    steps.push({ step: 'existing_results_ready', keywords });
    writeKeywordReport({ state: already, rows: alreadyRows }, steps);
  } else {
    if (!(await chooseVolumeMode())) {
      const s = await evalState();
      refuse({
        blocked: 'keyword_volume_mode_not_opened',
        customer: cid,
        keywords,
        url: s.url,
        text: norm(s.text),
        steps,
      });
    }
    steps.push({ step: 'volume_mode_ready', url: (await evalState()).url });

    await submitKeywords();
    steps.push({ step: 'keywords_submitted', keywords });

    writeKeywordReport(await waitForResults(), steps);
  }
} catch (error) {
  if (!error.reported) {
    writeResult({
      ok: false,
      blocked: 'google_ads_keyword_planner_keeper_error',
      error: error.message,
      session: SESSION,
      customer: cid,
      keywords,
    });
  }
  throw error;
}
