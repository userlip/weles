import { pageSettled } from '../../_shared/page/settled.mjs';
// Meta Ads Manager: create/fill a campaign draft in the browser.
//
// Env:
//   AD_ACCOUNT_ID        required unless ADS_URL is set; numeric or act_<id>
//   ADS_URL              optional direct Ads Manager creation URL
//   CAMPAIGN_NAME        required to create: the name the campaign is listed under
//   CAMPAIGN_OBJECTIVE   required to create: objective label text, e.g. Traffic, Leads
//   CAMPAIGN_DESTINATION required to create: destination family. Supported: website
//   DAILY_BUDGET_USD     optional daily budget
//   DESTINATION_URL      optional landing page URL
//   DISPLAY_LINK         optional visible display link
//   URL_PARAMS           optional URL tracking params
//   AD_NAME              required to create: ad name
//   AD_SET_NAME          required to create: ad set name
//   META_FACEBOOK_PAGE_NAME optional Facebook Page to select
//   META_FACEBOOK_PAGE_ID   optional Facebook Page id to select
//   PRIMARY_TEXT         optional ad primary text
//   HEADLINE             optional ad headline
//   DESCRIPTION          optional ad description
//   META_ADS_CAPABILITIES print supported params and exit
//   ALLOW_UNVERIFIED_META_PARAMS set "1" to warn instead of failing for unsupported params
//   SUBMIT               must be "1" to publish. Default stages only.
//   PROXY_URL            proxy URL or provider filter ('direct' for none);
//                        required unless the account session names its own proxy
//
// Requires a logged-in facebook account cookie jar. Run meta/facebook_login.mjs
// first when the session is stale.
//
// The run itself lives here: the admission checks, the session, the walk past
// the login gate, the account proof, the draft and the publish. The steps it is
// made of live in ./ads_campaign/.

import {
  AD_ACCOUNT_ID,
  CAMPAIGN_NAME,
  PRINT_CAPABILITIES,
  SUBMIT,
  USER_DATA_DIR,
  VERIFY_ACCOUNT_ONLY,
  guardUnsupportedParams,
  printCapabilitiesAndExit,
  profilePersona,
  requireCampaignInputs,
  requireCampaignTarget,
  session,
  targetUrl,
} from './ads_campaign/campaign_request.mjs';
import { WSession } from '../../../../dist/session/wsession.js';
import { closeObstructingPanels } from './ads_campaign/panel_controls.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import {
  bringBrowserToFront,
  ensureAdAccount,
  passLoginGate,
  visibleSelectedAdAccount,
} from './ads_campaign/ad_account_session.mjs';
import {
  chooseObjectiveAndContinue,
  openCampaignCreation,
  reportDraftOutcomeWithoutFields,
} from './ads_campaign/campaign_draft.mjs';
import {
  fillCampaignFields,
  verifyConfiguredDraft,
} from './ads_campaign/draft_fields.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';

if (PRINT_CAPABILITIES) printCapabilitiesAndExit();
guardUnsupportedParams();
requireCampaignTarget();
if (!VERIFY_ACCOUNT_ONLY) requireCampaignInputs();

console.log(
  `[meta-ads] profile=${USER_DATA_DIR} viewport=${process.env.WELES_VIEWPORT}`,
);
const s = await WSession.start({
  label: 'meta_ads_campaign',
  browser: process.env.BROWSER || 'chromium',
  proxy:
    session.proxyUrl && !process.env.PROXY_URL?.trim()
      ? session.proxyUrl
      : statedProxy('the campaign draft, whose account session names no proxy,'),
  persona: profilePersona,
  userDataDir: USER_DATA_DIR,
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});
try {
  await bringBrowserToFront(s);
  await s.goto(targetUrl);
  await pageSettled(s.page);
  await passLoginGate(s);

  await ensureAdAccount(s);
  if (VERIFY_ACCOUNT_ONLY) {
    const visible = await visibleSelectedAdAccount(s);
    console.log(
      `PASS: Meta Ads account verified (${visible.label || AD_ACCOUNT_ID})`,
    );
    process.exit(0);
  }
  await closeObstructingPanels(s);

  if (
    await pageShows(
      s.page,
      'Is a Meta advertising policy dialog open that asks to be accepted before continuing?',
    )
  ) {
    await clickDescribed(
      s.page,
      'the button that accepts the open advertising policy dialog',
    );
  }

  const createClicked = await openCampaignCreation(s);
  await chooseObjectiveAndContinue(s);
  const filledCount = await fillCampaignFields(s);

  // Nothing to verify and nothing to publish: this reports the staged draft or
  // refuses, and never comes back.
  if (!createClicked || filledCount === 0)
    await reportDraftOutcomeWithoutFields(s, createClicked, filledCount);

  if (!SUBMIT) {
    await verifyConfiguredDraft(s);
    console.log(
      `PASS: staged Meta ads campaign draft "${CAMPAIGN_NAME}" (SUBMIT=0, filled=${filledCount})`,
    );
    process.exit(0);
  }

  await clickDescribed(
    s.page,
    'the enabled button that publishes the campaign (or confirms its publication in an open dialog)',
  );
  const status = (await pageShows(
    s.page,
    'Does the page say the campaign was published, is processing, or is in review?',
  ))
    ? 'confirmed'
    : 'clicked';
  console.log(
    `PASS: Meta ads campaign publish ${status} for "${CAMPAIGN_NAME}"`,
  );
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
