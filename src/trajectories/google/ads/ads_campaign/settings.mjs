// The environment a Google Ads campaign submission arrives as.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { statedText } from '../../../_shared/inputs/stated.mjs';

export const ADS_URL = process.env.ADS_URL;
export const CUSTOMER_ID = process.env.GOOGLE_ADS_CUSTOMER_ID;
// What the campaign is called, what it is for and which type it is are the
// advertiser's choices: a campaign spends money under them, so none of them
// is picked here.
export const CAMPAIGN_NAME = statedText(
  ['CAMPAIGN_NAME'],
  'the name the Google Ads account lists the campaign under',
);
export const CAMPAIGN_OBJECTIVE = statedText(
  ['CAMPAIGN_OBJECTIVE'],
  'the campaign objective label chosen in Google Ads, e.g. Website traffic',
);
export const CAMPAIGN_TYPE = statedText(
  ['CAMPAIGN_TYPE'],
  'the campaign type label chosen in Google Ads, e.g. Search or App',
);
export const APP_ID = process.env.APP_ID;
export const PACKAGE_NAME = process.env.PACKAGE_NAME;
export const APP_NAME = process.env.APP_NAME;
export const APP_PLATFORM = process.env.APP_PLATFORM;
export const IS_APP_INSTALL = /app/i.test(CAMPAIGN_TYPE);
export const APP_CAMPAIGN_SUBTYPE = IS_APP_INSTALL
  ? statedText(
      ['APP_CAMPAIGN_SUBTYPE'],
      'the app campaign subtype chosen in Google Ads, e.g. App installs',
    )
  : undefined;
export const DAILY_BUDGET_USD = process.env.DAILY_BUDGET_USD;
export const FINAL_URL = process.env.FINAL_URL || process.env.DESTINATION_URL;
export const HEADLINE = process.env.HEADLINE;
export const DESCRIPTION = process.env.DESCRIPTION;
export const KEYWORDS = process.env.KEYWORDS;
export const LOCATIONS = process.env.LOCATIONS;
export const SUBMIT = process.env.SUBMIT === '1';
export const WAIT_FOR_LOGIN = process.env.WAIT_FOR_LOGIN === '1';
export const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'google_ads');
mkdirSync(USER_DATA_DIR, { recursive: true });

process.env.WELES_DISABLE_RECORDING ??= '1';
process.env.WELES_NO_INSTRUMENT ??= '1';
