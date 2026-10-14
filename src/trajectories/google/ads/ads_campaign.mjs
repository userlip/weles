import { pageSettled } from '../../_shared/page/settled.mjs';
// Google Ads: create/fill a campaign draft in the browser.
//
// Env:
//   GOOGLE_ADS_CUSTOMER_ID required unless ADS_URL is set
//   ADS_URL                optional direct Google Ads campaign creation URL
//   CAMPAIGN_NAME          required name the campaign is listed under
//   CAMPAIGN_TYPE          required label, e.g. Search, Display, Performance Max, App
//   CAMPAIGN_OBJECTIVE     required objective label, e.g. Website traffic
//   APP_CAMPAIGN_SUBTYPE   required for app campaigns, e.g. App installs
//   DAILY_BUDGET_USD       optional daily budget
//   FINAL_URL              optional landing page URL
//   APP_ID                 optional mobile app id for app install campaigns
//   PACKAGE_NAME           optional Android package name for app install campaigns
//   APP_NAME               optional app name for app install campaigns
//   APP_PLATFORM           optional Android | iOS
//   HEADLINE               optional ad headline
//   DESCRIPTION            optional ad description
//   KEYWORDS               optional comma-separated search keywords
//   LOCATIONS              optional comma-separated location names
//   SUBMIT                 must be "1" to publish. Default stages only.
//   PROXY_URL              proxy URL or provider filter ('direct' for none);
//                          required unless the account session names its own proxy
//
// Requires a logged-in google account cookie jar. Run google login/register
// flow first when the session is stale.

import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  assertGoogleAdsProfileNotAlreadyOpen,
  closeAllowedByEnv,
} from './_profile_guard.mjs';
import { closeGoogleAdsSession } from './_close_session.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import {
  ADS_URL,
  APP_CAMPAIGN_SUBTYPE,
  APP_ID,
  APP_NAME,
  APP_PLATFORM,
  CAMPAIGN_NAME,
  CAMPAIGN_OBJECTIVE,
  CAMPAIGN_TYPE,
  CUSTOMER_ID,
  DAILY_BUDGET_USD,
  DESCRIPTION,
  FINAL_URL,
  HEADLINE,
  IS_APP_INSTALL,
  KEYWORDS,
  LOCATIONS,
  PACKAGE_NAME,
  SUBMIT,
  USER_DATA_DIR,
  WAIT_FOR_LOGIN,
} from './ads_campaign/settings.mjs';
import {
  bringBrowserToFront,
  ensureCustomer,
  isLoginUrl,
  navigate,
  stableProfilePersona,
} from './ads_campaign/page.mjs';
import { humanType } from '../../../../dist/human/keyboard.js';
import {
  clickDescribed,
  fillDescribed,
  pageShows,
} from '../../_shared/page/judged/seen.mjs';

if (!ADS_URL && !CUSTOMER_ID && !WAIT_FOR_LOGIN) {
  console.log('FAIL: GOOGLE_ADS_CUSTOMER_ID or ADS_URL required');
  process.exit(1);
}

const acct = await getSocialAccount('google');
const session = acct
  ? await resolveAccountSession(acct)
  : { proxyUrl: undefined, persona: undefined };
const profilePersona =
  process.env.ADS_PROFILE_PERSONA === 'account' && session.persona
    ? session.persona
    : stableProfilePersona();

const baseUrl =
  ADS_URL ||
  (CUSTOMER_ID
    ? `https://ads.google.com/aw/campaigns/new?ocid=${encodeURIComponent(CUSTOMER_ID)}`
    : 'https://ads.google.com/aw/campaigns');
console.log(
  `[google-ads] profile=${USER_DATA_DIR} viewport=${process.env.WELES_VIEWPORT}`,
);
assertGoogleAdsProfileNotAlreadyOpen(USER_DATA_DIR, 'google_ads_campaign');
const s = await WSession.start({
  label: 'google_ads_campaign',
  browser: process.env.BROWSER || 'chromium',
  proxy:
    session.proxyUrl && !process.env.PROXY_URL?.trim()
      ? session.proxyUrl
      : statedProxy('the campaign draft, whose account session names no proxy,'),
  persona: profilePersona,
  userDataDir: USER_DATA_DIR,
});
try {
  await bringBrowserToFront(s);
  await navigate(s, baseUrl);
  await pageSettled(s.page);
  let url = s.page.url?.() ?? '';
  if (isLoginUrl(url)) {
    if (!WAIT_FOR_LOGIN) {
      console.log('FAIL: google session expired / not logged in');
      process.exit(2);
    }
    console.log('[google-ads] waiting for manual login in the open window');
    await bringBrowserToFront(s);
    await s.page.waitForURL((u) => !isLoginUrl(String(u)));
    await navigate(s, baseUrl);
    await pageSettled(s.page);
  }

  await ensureCustomer(s);

  // Every control and field below is found by the vision model from what it
  // does (`_shared/page/judged/seen.mjs`), in the account's interface
  // language; a stated value whose field is not on the page fails by name.
  if (!/\/campaigns\/new/i.test(s.page.url())) {
    await clickDescribed(s.page, 'the button that creates a new campaign');
  }
  await clickDescribed(
    s.page,
    `the campaign objective option labelled "${CAMPAIGN_OBJECTIVE}"`,
  );
  if (!/app$/i.test(CAMPAIGN_TYPE)) {
    await clickDescribed(
      s.page,
      `the campaign type option labelled "${CAMPAIGN_TYPE}"`,
    );
  }
  if (IS_APP_INSTALL) {
    await clickDescribed(
      s.page,
      `the app campaign subtype option labelled "${APP_CAMPAIGN_SUBTYPE}"`,
    );
    if (APP_PLATFORM)
      await clickDescribed(
        s.page,
        `the app platform option labelled "${APP_PLATFORM}"`,
      );
  }
  await clickDescribed(
    s.page,
    'the button that continues to the next step of the campaign setup',
  );

  const filled = [];
  const fill = async (description, value) => {
    if (!value) return;
    await fillDescribed(s.page, description, value);
    console.log(`[google-ads] filled: ${description}`);
    filled.push(description);
  };
  // A list (locations, keywords) is stated comma-separated and typed into its
  // field one entry per line.
  const fillList = async (description, csv) => {
    if (!csv) return;
    const values = csv
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) return;
    await clickDescribed(s.page, description);
    for (const value of values) {
      await humanType(s.page, value);
      await s.page.keyboard.press('Enter');
    }
    console.log(`[google-ads] filled: ${description}`);
    filled.push(description);
  };
  if (IS_APP_INSTALL)
    await fill(
      'the field that finds the app to promote by its name or package',
      APP_NAME || PACKAGE_NAME || APP_ID,
    );
  await fill('the campaign name field', CAMPAIGN_NAME);
  await fill('the daily budget field of the campaign', DAILY_BUDGET_USD);
  await fill('the final URL (website) field of the ad', FINAL_URL);
  await fillList('the field that adds target locations', LOCATIONS);
  await fillList('the field that adds keywords', KEYWORDS);
  await fill('the headline field of the ad', HEADLINE);
  await fill('the description field of the ad', DESCRIPTION);

  await clickDescribed(
    s.page,
    'the button that saves this step and continues to the next one',
  );

  if (!filled.length) {
    console.log(
      `FAIL: Google Ads campaign form took none of the stated values (url=${s.page.url()})`,
    );
    process.exit(1);
  }

  if (!SUBMIT) {
    console.log(
      `PASS: staged Google Ads campaign draft "${CAMPAIGN_NAME}" (SUBMIT=0, filled=${filledCount})`,
    );
    process.exit(0);
  }

  await clickDescribed(
    s.page,
    'the enabled button that publishes the campaign',
  );
  const status = (await pageShows(
    s.page,
    'Does the page say the campaign was published, created, is eligible or under review?',
  ))
    ? 'confirmed'
    : 'clicked';
  console.log(
    `PASS: Google Ads campaign publish ${status} for "${CAMPAIGN_NAME}"`,
  );
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  if (closeAllowedByEnv('GOOGLE_ADS_CLOSE_AFTER_HARVEST'))
    await closeGoogleAdsSession(s, 'google-ads');
  else console.log('[google-ads] leaving Google Ads profile open');
}
