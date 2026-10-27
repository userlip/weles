// Meta Ads browser access verifier.
//
// Reuses the persistent Weles Meta Ads profile and reports the selected
// account plus visible campaign rows. This path does not require a Marketing
// API token. Whether the profile is signed in is Meta's session cookies and
// its sign-in routes; which ad account Ads Manager opened is the `act`
// parameter of its address, and the account's name is read off the page by
// the vision model. A signed-out profile or a different account than the one
// stated fails the run.

import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { shownText } from '../../_shared/page/judged/seen.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import {
  keptProfileDir,
  stableProfilePersona,
} from '../../_shared/profile/persona.mjs';
import { profileForCheck } from '../../_shared/profile/clone.mjs';
import { holdsMetaSession } from '../../_shared/profile/meta_session.mjs';
import { isLoginUrl } from './session/login_wall.mjs';

const INDENT = '  ';
const ADS_MANAGER_CAMPAIGNS =
  'https://adsmanager.facebook.com/adsmanager/manage/campaigns';
const SOURCE_USER_DATA_DIR = keptProfileDir('meta_ads');
const WAIT_FOR_LOGIN = process.env.WAIT_FOR_LOGIN === '1';
const STATED_ACCOUNT =
  process.env.AD_ACCOUNT_ID || process.env.META_ADS_COMPANY_ACCOUNT_ID;
const AD_ACCOUNT_ID = STATED_ACCOUNT
  ? STATED_ACCOUNT.replace(/^act_/, '')
  : null;
const BUSINESS_ID = process.env.BUSINESS_ID || process.env.META_BUSINESS_ID;
const AD_ACCOUNT_NAME =
  process.env.AD_ACCOUNT_NAME || process.env.META_ADS_ACCOUNT_NAME;
const USE_PROFILE_CLONE = process.env.META_VERIFY_USE_PROFILE_CLONE !== '0';

function targetUrl() {
  if (process.env.ADS_URL) return process.env.ADS_URL;
  const url = new URL(ADS_MANAGER_CAMPAIGNS);
  if (AD_ACCOUNT_ID) url.searchParams.set('act', AD_ACCOUNT_ID);
  if (BUSINESS_ID) url.searchParams.set('business_id', BUSINESS_ID);
  return url.toString();
}

/** What the signed-in Ads Manager page shows: its title, headings and rows. */
function pageDetails() {
  const squash = (node) => node.innerText.replace(/\s+/g, ' ').trim();
  return {
    title: document.title,
    headings: Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
      .map(squash)
      .filter(Boolean),
    rows: Array.from(document.querySelectorAll('[role="row"], tr'))
      .map(squash)
      .filter(Boolean),
  };
}

function report(fields) {
  console.log(
    JSON.stringify({ platform: 'meta_ads', ...fields }, null, INDENT),
  );
}

const preparedProfile = profileForCheck(
  SOURCE_USER_DATA_DIR,
  'meta-verify',
  USE_PROFILE_CLONE,
);
console.log(
  `[meta-ads-verify-access] sourceProfile=${SOURCE_USER_DATA_DIR} clonedProfile=${USE_PROFILE_CLONE} account=${AD_ACCOUNT_ID ? AD_ACCOUNT_ID : 'not stated'}`,
);
const s = await WSession.start({
  label: 'meta_ads_verify_access',
  proxy: statedProxy('the Meta Ads access check'),
  persona: stableProfilePersona(SOURCE_USER_DATA_DIR),
  userDataDir: preparedProfile.dir,
  headless: process.env.META_VERIFY_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

try {
  await s.goto(targetUrl());
  await pageSettled(s.page);
  if (WAIT_FOR_LOGIN) {
    await s.page.waitForURL((url) => !isLoginUrl(String(url)));
    await pageSettled(s.page);
  }

  const current = s.page.url();
  if (
    isLoginUrl(current) ||
    !(await holdsMetaSession(s.ctx, ADS_MANAGER_CAMPAIGNS))
  ) {
    report({ loggedIn: false, url: current });
    throw new Error(
      `META_ADS_NOT_SIGNED_IN: the Meta Ads browser session is not signed in (url=${current})`,
    );
  }
  const visibleAccountId = new URL(current).searchParams.get('act');
  if (AD_ACCOUNT_ID && visibleAccountId !== AD_ACCOUNT_ID) {
    report({
      loggedIn: true,
      expectedAccountId: AD_ACCOUNT_ID,
      visibleAccountId,
      url: current,
    });
    throw new Error(
      `META_ADS_WRONG_ACCOUNT: Ads Manager opened account ${visibleAccountId} instead of ${AD_ACCOUNT_ID}`,
    );
  }
  const visibleAccountName = await shownText(
    s.page,
    'name of the ad account Ads Manager has selected',
  );
  if (
    AD_ACCOUNT_NAME &&
    !(
      visibleAccountName &&
      visibleAccountName.toLowerCase().includes(AD_ACCOUNT_NAME.toLowerCase())
    )
  ) {
    report({
      loggedIn: true,
      expectedAccountName: AD_ACCOUNT_NAME,
      visibleAccountName,
      url: current,
    });
    throw new Error(
      `META_ADS_WRONG_ACCOUNT: the selected account reads ${JSON.stringify(visibleAccountName)}, not ${JSON.stringify(AD_ACCOUNT_NAME)}`,
    );
  }
  report({
    loggedIn: true,
    expectedAccountId: AD_ACCOUNT_ID,
    visibleAccountId,
    visibleAccountName,
    url: current,
    ...(await s.page.evaluate(pageDetails)),
  });
  console.log('PASS: Meta Ads browser access verified');
} finally {
  await s.close();
  preparedProfile.cleanup();
}
