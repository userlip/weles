// Signing the planner's browser profile into the preferred Google Ads account.
// Whether the profile is on Google's sign-in host and holds Google's session
// is read by the shared profile reader (`_shared/profile/google_session.mjs`);
// the option to use another account is found by the vision model.
import { humanClickLocator } from '../../../../../../dist/human/mouse.js';
import { pageSettled } from '../../../../_shared/page/settled.mjs';
import { clickOffered } from '../../../../_shared/page/judged/seen.mjs';
import {
  GOOGLE_ACCOUNTS_HOST,
  holdsGoogleSession,
  onGoogleSignIn,
} from '../../../../_shared/profile/google_session.mjs';
import { googleSso } from '../../../../_shared/services/google_sso.mjs';
import { GOOGLE_ADS_LOGIN } from './settings.mjs';

const GOOGLE_ADS_HOST = 'ads.google.com';
const EMAIL_FIELD =
  'input[type="email"], input[name="identifier"], input#identifierId';

let authFailure = null;
/** Why the last sign-in did not end signed in, or null. */
export function lastAuthFailure() {
  return authFailure;
}

export function preferredGoogleAdsEmail() {
  return GOOGLE_ADS_LOGIN.email;
}

/** Whether the page shows Google's email field. */
async function emailFieldShown(page) {
  return Boolean(
    await page.locator(EMAIL_FIELD).filter({ visible: true }).count(),
  );
}

/**
 * On Google's account chooser of a profile that holds Google's session,
 * select the preferred account. Returns whether it was selected.
 */
export async function continueFromAccountChooser(s) {
  if (!onGoogleSignIn(s.page.url())) return false;
  if (!(await holdsGoogleSession(s.ctx, s.page.url()))) return false;
  const email = preferredGoogleAdsEmail();
  const preferred = s.page
    .getByText(email, { exact: false })
    .filter({ visible: true })
    .first();
  if (!(await preferred.isVisible())) return false;
  console.log(
    `[google-ads-keyword-planner] selecting persisted account ${email}`,
  );
  await humanClickLocator(s.page, preferred);
  await pageSettled(s.page);
  return true;
}

/** Open Google's identifier step for `email`, returning to `returnUrl`. */
async function navigateGoogleIdentifier(page, email, returnUrl) {
  const login = new URL(`https://${GOOGLE_ACCOUNTS_HOST}/signin/v2/identifier`);
  login.searchParams.set('service', 'adwords');
  login.searchParams.set('continue', returnUrl);
  login.searchParams.set('flowName', 'GlifWebSignIn');
  login.searchParams.set('flowEntry', 'ServiceLogin');
  login.searchParams.set('Email', email);
  await page.goto(login.toString(), { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
}

/**
 * Sign the profile in as the preferred account through the shared Google
 * SSO. A login item without a password, or an SSO that does not complete,
 * is recorded as the reason (`lastAuthFailure`) and answered with false.
 */
async function runPreferredGoogleSso(s, returnUrl) {
  const creds = { ...GOOGLE_ADS_LOGIN, source: 'skarbiec' };
  if (!creds.password) {
    console.log(
      `[google-ads-keyword-planner] FAIL: the Google Ads login item for ${creds.email} holds no password`,
    );
    authFailure = {
      blocked: 'missing_google_ads_credentials',
      email: creds.email,
      detail: 'The dedicated Google Ads Skarbiec item holds no password.',
    };
    return false;
  }

  if (onGoogleSignIn(s.page.url()) && !(await emailFieldShown(s.page))) {
    if (await clickOffered(s.page, 'the option to use another account'))
      await pageSettled(s.page);
  }
  if (!onGoogleSignIn(s.page.url()) || !(await emailFieldShown(s.page))) {
    await navigateGoogleIdentifier(s.page, creds.email, returnUrl);
  }

  console.log(
    `[google-ads-keyword-planner] running automated Google SSO for ${creds.email} source=${creds.source}`,
  );
  if (!(await googleSso(s, creds, { originHost: GOOGLE_ADS_HOST }))) {
    authFailure = {
      blocked: 'google_sso_failed',
      email: creds.email,
      source: creds.source,
      detail: `Google SSO did not complete login (url=${s.page.url()}).`,
    };
    return false;
  }
  if (new URL(s.page.url()).hostname !== GOOGLE_ADS_HOST) {
    await s.page.goto(returnUrl, { waitUntil: 'domcontentloaded' });
  }
  await pageSettled(s.page);
  return true;
}

/**
 * Make the preferred account the signed-in one: from Google's chooser when
 * the profile already holds it, otherwise through the shared Google SSO.
 */
export async function ensurePreferredGoogleAccount(s, returnUrl) {
  const email = preferredGoogleAdsEmail();
  if (onGoogleSignIn(s.page.url())) {
    if ((await continueFromAccountChooser(s)) && !onGoogleSignIn(s.page.url()))
      return true;
    return await runPreferredGoogleSso(s, returnUrl);
  }
  const text = await s.page.evaluate(() => document.body.innerText);
  if (text.includes(email)) return true;
  const chooser = new URL(`https://${GOOGLE_ACCOUNTS_HOST}/AccountChooser`);
  chooser.searchParams.set('Email', email);
  chooser.searchParams.set('continue', returnUrl);
  chooser.searchParams.set('service', 'adwords');
  await s.page.goto(chooser.toString(), { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  if (!(await continueFromAccountChooser(s)))
    return await runPreferredGoogleSso(s, returnUrl);
  return true;
}
