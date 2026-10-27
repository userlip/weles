// Apple Ads report harvester.
//
// Uses a Weles browser session and reads DOM/network only. Authentication is
// delegated exclusively to an explicitly authorized apple_login run.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  DATE_PRESETS,
  DIAG_DIR,
  EXACT_RANGES,
  REPORT_URL,
  SESSION_LABEL,
  USER_DATA_DIR,
} from './report_harvest/settings.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';
import {
  ensureReportPage,
  gotoAndWait,
  installNetworkCapture,
  requireAuthenticatedSession,
} from './report_harvest/session.mjs';
import {
  clickDatePreset,
  collectPageState,
} from './report_harvest/page_state.mjs';
import {
  getCampaignReportPayload,
  sanitizeResponses,
  summarizeGraphqlRequests,
  summarizeGraphqlResponses,
  summarizeReport,
} from './report_harvest/summaries.mjs';
import {
  fetchExactCampaignReports,
  keepOpen,
  summarizeExactReports,
} from './report_harvest/exact_reports.mjs';

const OUT_PATH = join(DIAG_DIR, 'report_harvest.json');

async function harvest() {
  const acct = await getSocialAccount('apple');
  if (!acct) throw new Error('no active apple account to harvest with');

  const { proxyUrl } = await resolveAccountSession(acct);
  const s = await WSession.start({
    label: SESSION_LABEL,
    proxy:
      proxyUrl ??
      statedProxy(
        'the Apple Ads report harvest, whose account names no proxy,',
      ),
    persona: stableProfilePersona(USER_DATA_DIR),
    userDataDir: USER_DATA_DIR,
    record: false,
    pageDiagnostics: false,
  });

  let completed = false;
  try {
    const network = installNetworkCapture(s.page);
    await gotoAndWait(s.page, REPORT_URL);
    console.log(
      `[apple-ads-report-harvest] before login check url=${s.page.url()}`,
    );
    const loggedIn = await requireAuthenticatedSession(s);
    console.log(
      `[apple-ads-report-harvest] login check loggedIn=${loggedIn} url=${s.page.url()}`,
    );
    if (!loggedIn)
      throw new Error(
        `APPLE_ADS_SIGN_IN_REQUIRED: the profile is not signed in to Apple Ads at ${s.page.url()}; run an explicitly authorized apple_login first`,
      );
    // The signed-in session is kept for the next run; a session that cannot
    // be saved is said now, not met as an expired login next time.
    await s.saveCookies();
    if (!/\/report/i.test(s.page.url())) {
      await gotoAndWait(s.page, REPORT_URL);
    } else {
      await pageSettled(s.page);
    }
    if (!(await ensureReportPage(s.page)))
      throw new Error(
        `APPLE_ADS_REPORT_PAGE_UNLOADED: the Apple Ads report page did not load (${s.page.url()})`,
      );
    // Apple signs in on its own identity host, so the reports route on the
    // Apple Ads host, which ensureReportPage just confirmed, is a signed-in
    // page.
    const protectedUrl = new URL(s.page.url());
    const authenticatedProtectedPage =
      protectedUrl.hostname === new URL(REPORT_URL).hostname &&
      /\/report(?:\/|$)/i.test(protectedUrl.pathname);
    if (!authenticatedProtectedPage)
      throw new Error(
        `APPLE_ADS_REPORT_PAGE_UNCONFIRMED: ${s.page.url()} is not the signed-in Apple Ads report page; run an explicitly authorized apple_login before retrying`,
      );

    const snapshots = [];
    const current = await collectPageState(s.page);
    snapshots.push({
      label: 'initial',
      click: null,
      page: current,
      summary: summarizeReport(current, sanitizeResponses(s.capturedResponses)),
    });

    for (const preset of DATE_PRESETS) {
      const click = await clickDatePreset(s.page, preset);
      await pageSettled(s.page);
      const page = await collectPageState(s.page);
      snapshots.push({
        label: preset,
        click,
        page,
        summary: summarizeReport(page, sanitizeResponses(s.capturedResponses)),
      });
    }

    await pageSettled(s.page);
    const templatePayload = getCampaignReportPayload(network.requests);
    const exactReports = await fetchExactCampaignReports(
      s.page,
      templatePayload,
      EXACT_RANGES,
    );
    const exactSummary = summarizeExactReports(exactReports);
    const responses = sanitizeResponses(s.capturedResponses);
    const observedRequests = network.requests.slice();
    const observedResponses = network.responses.slice();
    const [initialSnapshot, ...presetSnapshots] = snapshots;
    const summary = {
      initial: initialSnapshot.summary,
      presets: presetSnapshots.map((snapshot) => ({
        label: snapshot.label,
        click: snapshot.click,
        summary: snapshot.summary,
      })),
      graphqlRequests: summarizeGraphqlRequests(observedRequests),
      graphqlResponses: summarizeGraphqlResponses(observedResponses),
      exactReports: exactSummary,
    };
    const output = {
      ok: true,
      reportUrl: REPORT_URL,
      capturedAt: new Date().toISOString(),
      snapshots,
      responses,
      observedRequests,
      observedResponses,
      captureFailures: network.failures,
      exactReports,
      summary,
    };
    writeFileSync(OUT_PATH, JSON.stringify(output, null, '  '));
    await s.saveCookies();
    console.log(`[apple-ads-report-harvest] json=${OUT_PATH}`);
    console.log(JSON.stringify(summary, null, '  '));
    completed = true;
  } finally {
    await keepOpen(s, completed);
  }
}

try {
  await harvest();
} catch (error) {
  console.error('FAIL:', String(error));
  try {
    writeFileSync(
      OUT_PATH,
      JSON.stringify({ ok: false, error: String(error) }),
    );
    console.error(`[apple-ads-report-harvest] json=${OUT_PATH}`);
  } catch (writeError) {
    console.error(
      '[apple-ads-report-harvest] failed to write report:',
      writeError,
    );
  }
  throw error;
}
