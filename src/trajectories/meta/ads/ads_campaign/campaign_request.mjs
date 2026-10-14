// What this run was asked to do.
//
// The campaign parameters come from the environment, the browser profile is
// the one this trajectory reuses between runs, the objective label is the one
// the request states, as the account's Ads Manager shows it in its language,
// and the target URL is the Ads Manager address the run opens. The same
// module carries the catalog of parameters this trajectory can honour and the
// refusal it prints when the request names something it cannot configure.
//
// Loading this module creates the profile directory, defaults the viewport,
// reads the stored persona and resolves the facebook account session, in that
// order - the order the root file performed them in before the split.

import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../../dist/utils/credentials.js';
import { generatePersona } from '../../../../../dist/browser/persona.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { statedText } from '../../../_shared/inputs/stated.mjs';

const ADS_URL = process.env.ADS_URL;
const RAW_AD_ACCOUNT_ID =
  process.env.AD_ACCOUNT_ID || process.env.META_ADS_COMPANY_ACCOUNT_ID;
const AD_ACCOUNT_ID = RAW_AD_ACCOUNT_ID?.replace(/^act_/, '');
const BUSINESS_ID = process.env.BUSINESS_ID || process.env.META_BUSINESS_ID;
const AD_ACCOUNT_NAME =
  process.env.AD_ACCOUNT_NAME || process.env.META_ADS_ACCOUNT_NAME;
// The names, objective and destination of a new campaign are the advertiser's
// to state; requireCampaignInputs() refuses a run that creates one without
// them. A run that only verifies the account or prints capabilities needs none.
const CAMPAIGN_NAME = process.env.CAMPAIGN_NAME;
const CAMPAIGN_OBJECTIVE = process.env.CAMPAIGN_OBJECTIVE;
const CAMPAIGN_DESTINATION = (
  process.env.CAMPAIGN_DESTINATION || process.env.DESTINATION_TYPE
)?.toLowerCase();
const DAILY_BUDGET_USD = process.env.DAILY_BUDGET_USD;
const DESTINATION_URL = process.env.DESTINATION_URL || process.env.FINAL_URL;
const DISPLAY_LINK = process.env.DISPLAY_LINK;
const URL_PARAMS = process.env.URL_PARAMS;
const AD_SET_NAME = process.env.AD_SET_NAME;
const AD_NAME = process.env.AD_NAME;
const FACEBOOK_PAGE_NAME =
  process.env.META_FACEBOOK_PAGE_NAME || process.env.FACEBOOK_PAGE_NAME;
const FACEBOOK_PAGE_ID =
  process.env.META_FACEBOOK_PAGE_ID || process.env.FACEBOOK_PAGE_ID;
const PRIMARY_TEXT = process.env.PRIMARY_TEXT;
const HEADLINE = process.env.HEADLINE;
const DESCRIPTION = process.env.DESCRIPTION;
const SUBMIT = process.env.SUBMIT === '1';
const PRINT_CAPABILITIES = process.env.META_ADS_CAPABILITIES === '1';
const ALLOW_UNVERIFIED_META_PARAMS =
  process.env.ALLOW_UNVERIFIED_META_PARAMS === '1';
const WAIT_FOR_LOGIN = process.env.WAIT_FOR_LOGIN === '1';
const VERIFY_ACCOUNT_ONLY = process.env.VERIFY_ACCOUNT_ONLY === '1';
const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
mkdirSync(USER_DATA_DIR, { recursive: true });

function stableProfilePersona() {
  const p = join(USER_DATA_DIR, 'persona.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const persona = generatePersona({ os: 'macos', browser: 'chromium' });
  writeFileSync(p, JSON.stringify(persona, null, 2));
  return persona;
}

const acct = await getSocialAccount('facebook');
const session = acct
  ? await resolveAccountSession(acct)
  : { proxyUrl: undefined, persona: undefined };
const profilePersona =
  process.env.ADS_PROFILE_PERSONA === 'account' && session.persona
    ? session.persona
    : stableProfilePersona();

// The objective is picked by the label the request states. Ads Manager speaks
// the account's language, so the request names the objective as that account
// shows it; a label the page does not show is refused by the selection step
// with the controls the page does show.
const objectiveLabels = [CAMPAIGN_OBJECTIVE];

const targetUrl =
  ADS_URL ||
  (AD_ACCOUNT_ID
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?${new URLSearchParams({ act: AD_ACCOUNT_ID, ...(BUSINESS_ID ? { business_id: BUSINESS_ID } : {}) })}`
    : 'https://adsmanager.facebook.com/adsmanager/manage/campaigns');

const CAPABILITIES = {
  verified: {
    create: [
      'website traffic campaign draft',
      'existing draft configuration via ADS_URL',
    ],
    read: ['campaign table/performance browser read'],
    update: [
      'existing draft fields via ADS_URL',
      'CLI update when Meta CLI exists',
    ],
    publish: 'guarded by SUBMIT=1; not used in verification',
  },
  supportedParams: [
    'AD_ACCOUNT_ID',
    'META_ADS_COMPANY_ACCOUNT_ID',
    'BUSINESS_ID',
    'META_BUSINESS_ID',
    'AD_ACCOUNT_NAME',
    'ADS_URL',
    'CAMPAIGN_NAME',
    'CAMPAIGN_OBJECTIVE',
    'CAMPAIGN_DESTINATION=website',
    'AD_SET_NAME',
    'AD_NAME',
    'META_FACEBOOK_PAGE_NAME',
    'META_FACEBOOK_PAGE_ID',
    'DESTINATION_URL',
    'DISPLAY_LINK',
    'URL_PARAMS',
    'DAILY_BUDGET_USD',
    'PRIMARY_TEXT',
    'HEADLINE',
    'DESCRIPTION',
    'SUBMIT',
  ],
  objectiveLabelSelectedAsStated: 'CAMPAIGN_OBJECTIVE',
  unsupportedWithoutCustomExtension: [
    'catalog/product-set campaigns',
    'app install / app event setup',
    'lead forms',
    'WhatsApp / Messenger destinations',
    'Advantage+ shopping end-to-end setup',
    'custom audiences, lookalikes, detailed targeting',
    'creative media upload',
    'placement matrix and bid strategy tuning',
  ],
};

function printCapabilitiesAndExit() {
  console.log(JSON.stringify(CAPABILITIES, null, 2));
  process.exit(0);
}

function guardUnsupportedParams() {
  const unsupported = [];
  const unsupportedEnv = [
    'PRODUCT_SET_ID',
    'CATALOG_ID',
    'APP_ID',
    'APP_EVENT',
    'LEAD_FORM_ID',
    'WHATSAPP_NUMBER',
    'MESSENGER_DESTINATION',
    'CUSTOM_AUDIENCE_ID',
    'LOOKALIKE_SOURCE_ID',
    'PLACEMENTS',
    'BID_STRATEGY',
    'OPTIMIZATION_GOAL',
    'BILLING_EVENT',
    'CREATIVE_ASSET_PATH',
    'IMAGE_PATH',
    'VIDEO_PATH',
  ];
  for (const key of unsupportedEnv) {
    if (process.env[key]) unsupported.push(key);
  }
  if (CAMPAIGN_DESTINATION && CAMPAIGN_DESTINATION !== 'website')
    unsupported.push(`CAMPAIGN_DESTINATION=${CAMPAIGN_DESTINATION}`);
  if (!unsupported.length) return;
  const msg = `unsupported/unverified Meta campaign params: ${unsupported.join(', ')}. Supported verified destination is website traffic draft/configuration.`;
  if (!ALLOW_UNVERIFIED_META_PARAMS) {
    console.log(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`[meta-ads] WARN: ${msg}`);
}

// Without an account or a direct creation URL there is nothing to open, unless
// the run is here to wait for a human to log in first.
function requireCampaignTarget() {
  if (!ADS_URL && !AD_ACCOUNT_ID && !WAIT_FOR_LOGIN) {
    console.log('FAIL: AD_ACCOUNT_ID or ADS_URL required');
    process.exit(1);
  }
}

// What creating a campaign needs stated; each missing value is refused by name.
function requireCampaignInputs() {
  statedText(['CAMPAIGN_NAME'], 'the name the ad account lists the campaign under');
  statedText(
    ['CAMPAIGN_OBJECTIVE'],
    "the campaign objective, as the account's Ads Manager labels it (e.g. Traffic)",
  );
  statedText(
    ['CAMPAIGN_DESTINATION', 'DESTINATION_TYPE'],
    'where the ad sends people; this trajectory configures website',
  );
  statedText(['AD_SET_NAME'], 'the name the ad account lists the ad set under');
  statedText(['AD_NAME'], 'the name the ad account lists the ad under');
}

export {
  AD_ACCOUNT_ID,
  AD_ACCOUNT_NAME,
  AD_NAME,
  AD_SET_NAME,
  BUSINESS_ID,
  CAMPAIGN_NAME,
  DAILY_BUDGET_USD,
  DESCRIPTION,
  DESTINATION_URL,
  DISPLAY_LINK,
  FACEBOOK_PAGE_ID,
  FACEBOOK_PAGE_NAME,
  HEADLINE,
  PRIMARY_TEXT,
  PRINT_CAPABILITIES,
  SUBMIT,
  URL_PARAMS,
  USER_DATA_DIR,
  VERIFY_ACCOUNT_ONLY,
  WAIT_FOR_LOGIN,
  guardUnsupportedParams,
  requireCampaignInputs,
  objectiveLabels,
  printCapabilitiesAndExit,
  profilePersona,
  requireCampaignTarget,
  session,
  targetUrl,
};
