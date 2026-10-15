// Google Ads UI fallback: collect Keyword Planner keyword volume without
// REST keyword-planning service access.
//
// Env:
//   GOOGLE_ADS_CUSTOMER_ID       required
//   GOOGLE_ADS_KEYWORDS          required, comma/newline separated
//   GOOGLE_ADS_RESULT_FILE       optional JSON output path
//   PROXY_URL                    required proxy URL or provider filter; 'direct' for none
//   Login identity/password/MFA are read only from the dedicated Google Ads Skarbiec item.
//
// Every run writes its report to the result file. A refusal (signed out,
// verification required, planner not opened, or any error) is written with
// its `blocked` cause and then thrown, so the run fails with it.

import { writeFileSync } from 'node:fs';
import { WSession } from '../../../../../dist/session/wsession.js';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { assertGoogleAdsProfileNotAlreadyOpen } from '../_profile_guard.mjs';
import { closeGoogleAdsSession } from '../_close_session.mjs';
import {
  CLOSE_AFTER_HARVEST,
  RESULT_FILE,
  USER_DATA_DIR,
  cid,
  keywords,
  norm,
} from './planner/settings.mjs';
import {
  continueFromAccountChooser,
  ensurePreferredGoogleAccount,
  lastAuthFailure,
} from './planner/sign_in.mjs';
import {
  campaignsUrl,
  installKeywordPlannerCapture,
} from './planner/capture.mjs';
import { collectKeywordPlanner, openKeywordPlanner } from './planner/page.mjs';
import { pageShows } from '../../../_shared/page/judged/seen.mjs';
import { statedProxy } from '../../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../../_shared/profile/persona.mjs';
import { onGoogleSignIn } from '../../../_shared/profile/google_session.mjs';

const INDENT = '  ';

function writeReport(report) {
  writeFileSync(RESULT_FILE, JSON.stringify(report, null, INDENT));
  console.log(JSON.stringify(report, null, INDENT));
}

/** Write a refusal report, then throw it so the run fails with its cause. */
function refuse(report) {
  writeReport({ ok: false, customer: cid, keywords, ...report });
  const refusal = new Error(
    `${report.blocked}: Keyword Planner run refused (url=${report.url})`,
  );
  refusal.reported = true;
  throw refusal;
}

/** Whether the page asks for 2-step verification before Google Ads opens. */
async function verificationRequired(page) {
  const url = new URL(page.url());
  return (
    url.pathname.toLowerCase().includes('multifactorauthalert') ||
    url.searchParams.get('block') === 'true' ||
    (await pageShows(
      page,
      'Does the page say 2-step verification or multi-factor authentication is required?',
    ))
  );
}

console.log(
  `[google-ads-keyword-planner] customer=${cid} keywords=${JSON.stringify(keywords)}`,
);
const startUrl = campaignsUrl('cid', cid);
let s;
try {
  assertGoogleAdsProfileNotAlreadyOpen(
    USER_DATA_DIR,
    'google_ads_keyword_planner',
  );
  s = await WSession.start({
    label: 'google_ads_keyword_planner',
    proxy: statedProxy('Keyword Planner'),
    persona: stableProfilePersona(USER_DATA_DIR),
    userDataDir: USER_DATA_DIR,
    pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
  });
  const captured = installKeywordPlannerCapture(s.page);
  await s.page.goto(startUrl, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  await ensurePreferredGoogleAccount(s, startUrl);
  await continueFromAccountChooser(s);
  await pageSettled(s.page);

  const current = s.page.url();
  const text = await s.page.evaluate(() => document.body.innerText);
  if (onGoogleSignIn(current)) {
    const authFailure = lastAuthFailure();
    refuse({
      blocked: authFailure
        ? authFailure.blocked
        : 'google_ads_browser_session_not_logged_in',
      url: current,
      authFailure,
      textPreview: norm(text),
    });
  }
  if (await verificationRequired(s.page)) {
    refuse({
      blocked: 'google_ads_mfa_required',
      url: current,
      textPreview: norm(text),
    });
  }

  const open = await openKeywordPlanner(s);
  if (!open.ok) {
    refuse({ blocked: 'keyword_planner_not_opened', url: s.page.url(), open });
  }

  const report = await collectKeywordPlanner(s, captured);
  report.open = open;
  report.ok = Boolean(
    report.parsedRows.length || report.rpc.keywordMentions.length,
  );
  writeFileSync(RESULT_FILE, JSON.stringify(report, null, INDENT));
  console.log(`GOOGLE_ADS_KEYWORD_PLANNER_REPORT ${JSON.stringify(report)}`);
  console.log(JSON.stringify(report, null, INDENT));
  console.log('PASS: Google Ads keyword planner read completed (browser)');
} catch (error) {
  if (!error.reported) {
    writeReport({
      ok: false,
      blocked: 'google_ads_keyword_planner_error',
      customer: cid,
      keywords,
      error: error.message,
    });
  }
  throw error;
} finally {
  // A session that never opened has nothing to close or leave open.
  if (s && CLOSE_AFTER_HARVEST)
    await closeGoogleAdsSession(s, 'google-ads-keyword-planner');
  else if (s)
    console.log('[google-ads-keyword-planner] leaving Google Ads profile open');
}
