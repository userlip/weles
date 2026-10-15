// Meta Ads CLI/browser: read campaign/ad performance.
//
// Env:
//   CAMPAIGN_ID         optional campaign id for campaign-scoped insights
//   AD_ACCOUNT_ID       optional act_<id> / numeric account id
//   DATE_PRESET         required: Meta's date preset for the window, e.g. last_7d
//   FIELDS              comma-separated insights fields; required for the Marketing API read
//   LEVEL               required for the Marketing API read: account, campaign, adset or ad
//   META_ADS_CLI_ARGS   optional full arg string after `meta`; bypasses generated args
//   META_CLI_REQUIRED   1 refuses the browser read when the Meta CLI is unavailable
//   META_API_ONLY       1 reads through the Marketing API only
//
// The read goes through the Marketing API when its integration is configured
// (or META_API_ONLY=1), through Meta's official Ads CLI (`meta` on PATH) when
// it is installed and authenticated, and otherwise through the logged-in Ads
// Manager browser profile. Every refusal is thrown with its cause.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WSession } from '../../../../dist/session/wsession.js';
import { graphRequest } from './api/marketing_api.mjs';
import { integrationsConfigured } from '../../../_shared/integrations.mjs';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { shownText } from '../../_shared/page/judged/seen.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';
import {
  cliUnavailable,
  runMetaCommand,
  splitArgs,
} from './cli/meta_cli.mjs';

const INDENT = '  ';
const CAMPAIGN_ID = process.env.CAMPAIGN_ID;
const STATED_ACCOUNT =
  process.env.AD_ACCOUNT_ID || process.env.META_ADS_COMPANY_ACCOUNT_ID;
const AD_ACCOUNT_ID = STATED_ACCOUNT
  ? STATED_ACCOUNT.replace(/^act_/, '')
  : null;
const BUSINESS_ID = process.env.BUSINESS_ID || process.env.META_BUSINESS_ID;
const AD_ACCOUNT_NAME =
  process.env.AD_ACCOUNT_NAME || process.env.META_ADS_ACCOUNT_NAME;
const META_ADS_CLI_ARGS = process.env.META_ADS_CLI_ARGS;
// Which days the numbers cover is the caller's to say; a report over a window
// nobody chose reads as the one they meant. Full META_ADS_CLI_ARGS carry their
// own window.
const DATE_PRESET = META_ADS_CLI_ARGS
  ? undefined
  : statedText(
      ['DATE_PRESET'],
      "Meta's date preset for the report window (e.g. last_7d, last_30d)",
    );
const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
mkdirSync(USER_DATA_DIR, { recursive: true });

async function browserPerformance() {
  if (!AD_ACCOUNT_ID)
    throw new Error(
      'AD_ACCOUNT_ID or META_ADS_COMPANY_ACCOUNT_ID is required for the browser read',
    );
  const url = new URL('https://adsmanager.facebook.com/adsmanager/manage/campaigns');
  url.searchParams.set('act', AD_ACCOUNT_ID);
  if (BUSINESS_ID) url.searchParams.set('business_id', BUSINESS_ID);
  const s = await WSession.start({
    label: 'meta_ads_performance',
    proxy: statedProxy('the Meta Ads performance read'),
    persona: stableProfilePersona(USER_DATA_DIR),
    userDataDir: USER_DATA_DIR,
    pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
  });
  try {
    await s.goto(url.toString());
    await pageSettled(s.page);
    const current = new URL(s.page.url());
    // A session that is not signed in is sent away from Ads Manager (to the
    // login, checkpoint or security pages), so staying on its route is the
    // signed-in answer.
    if (!current.pathname.startsWith('/adsmanager/'))
      throw new Error(
        `META_ADS_NOT_SIGNED_IN: the Meta Ads browser session is not signed in (${current})`,
      );
    const visibleId = current.searchParams.get('act');
    if (visibleId !== AD_ACCOUNT_ID)
      throw new Error(
        `META_ADS_WRONG_ACCOUNT: Ads Manager opened account ${visibleId} instead of ${AD_ACCOUNT_ID}`,
      );
    const visibleName = await shownText(
      s.page,
      'name of the ad account Ads Manager has selected',
    );
    console.log(
      `[meta-ads-performance] browser account=${JSON.stringify(visibleName)} url=${current}`,
    );
    if (
      AD_ACCOUNT_NAME &&
      !(
        visibleName &&
        visibleName.toLowerCase().includes(AD_ACCOUNT_NAME.toLowerCase())
      )
    )
      throw new Error(
        `META_ADS_WRONG_ACCOUNT: the selected account reads ${JSON.stringify(visibleName)}, not ${JSON.stringify(AD_ACCOUNT_NAME)}`,
      );
    const rows = await s.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="row"], tr'))
        .map((row) => row.innerText.replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    );
    // An empty account is read from the rows themselves, not guessed from the
    // wording of an empty-state banner.
    console.log(JSON.stringify({ account: visibleName, rows }, null, INDENT));
    console.log('PASS: Meta Ads performance read completed (browser)');
  } finally {
    await s.close();
  }
}

async function apiPerformance() {
  if (!AD_ACCOUNT_ID && !CAMPAIGN_ID)
    throw new Error(
      'AD_ACCOUNT_ID/META_ADS_COMPANY_ACCOUNT_ID or CAMPAIGN_ID is required for the Marketing API read',
    );
  const fields = statedText(
    ['FIELDS'],
    'the comma-separated insights fields the Marketing API read returns',
  );
  const params = {
    fields,
    date_preset: DATE_PRESET,
    level: statedText(
      ['LEVEL'],
      'the insights level to break the numbers down by (account, campaign, adset or ad)',
    ),
    filtering: process.env.FILTERING_JSON
      ? JSON.parse(process.env.FILTERING_JSON)
      : undefined,
    limit: process.env.LIMIT,
  };
  const path = CAMPAIGN_ID
    ? `/${CAMPAIGN_ID}/insights`
    : `/act_${AD_ACCOUNT_ID}/insights`;
  console.log(`[meta-ads-performance] API ${path} fields=${fields}`);
  await graphRequest('GET', path, params, {
    execute: true,
    label: 'meta-ads-performance-api',
  });
  console.log('PASS: Meta Ads performance read completed (api)');
}

async function cliPerformance() {
  const args = META_ADS_CLI_ARGS
    ? splitArgs(META_ADS_CLI_ARGS)
    : [
        'ads',
        'insights',
        'get',
        ...(CAMPAIGN_ID ? ['--campaign-id', CAMPAIGN_ID] : []),
        ...(AD_ACCOUNT_ID ? ['--ad-account-id', AD_ACCOUNT_ID] : []),
        '--date-preset',
        DATE_PRESET,
        ...(process.env.FIELDS ? ['--fields', process.env.FIELDS] : []),
        '--output',
        'json',
      ];
  await runMetaCommand('meta-ads-performance', args);
  console.log('PASS: Meta Ads performance read completed');
}

if (integrationsConfigured() || process.env.META_API_ONLY === '1') {
  await apiPerformance();
} else {
  const unavailable = await cliUnavailable();
  if (!unavailable) await cliPerformance();
  else if (process.env.META_CLI_REQUIRED === '1')
    throw new Error(`META_CLI_REQUIRED: ${unavailable}`);
  else {
    console.log(
      `[meta-ads-performance] ${unavailable}; reading through the browser profile`,
    );
    await browserPerformance();
  }
}
