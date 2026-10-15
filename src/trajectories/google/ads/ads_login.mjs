import { pageSettled } from '../../_shared/page/settled.mjs';
// Google Ads persistent login bootstrap.
//
// Signs the Google Ads profile in through the shared Google SSO with the
// login item granted to googleAds, then confirms the profile holds Google's
// session cookies for Ads, so later Google Ads trajectories reuse it.

import { WSession } from '../../../../dist/session/wsession.js';
import { googleSso } from '../../_shared/services/google_sso.mjs';
import { dismissGooglePostLogin } from '../../_shared/services/google_sso/sign_in/redirect_watch.mjs';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assertGoogleAdsProfileNotAlreadyOpen,
  closeAllowedByEnv,
} from './_profile_guard.mjs';
import { closeGoogleAdsSession } from './_close_session.mjs';
import { readScopedLogin } from '../../../_shared/scoped-secrets.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';

const GOOGLE_ADS_URL = 'https://ads.google.com/aw/campaigns';
// Google signs every product in on its accounts host.
const GOOGLE_ACCOUNTS_HOST = 'accounts.google.com';
const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'google_ads');
// The login is read from Skarbiec before anything opens; an unreadable or
// ungranted item ends the run with Skarbiec's own refusal.
const GOOGLE_ADS_LOGIN = readScopedLogin('googleAds');
mkdirSync(USER_DATA_DIR, { recursive: true });

async function bringBrowserToFront(s) {
  await s.page.bringToFront();
  if (process.platform !== 'darwin') return;
  spawnSync('osascript', ['-e', 'tell application "Chromium" to activate'], {
    stdio: 'ignore',
  });
  spawnSync(
    'osascript',
    [
      '-e',
      'tell application "System Events" to set frontmost of every process whose name is "Chromium" to true',
    ],
    { stdio: 'ignore' },
  );
}

function onSignInPage(url) {
  return new URL(url).hostname === GOOGLE_ACCOUNTS_HOST;
}

/** The names of the cookies Google Ads would be sent. */
async function adsCookieNames(s) {
  const cookies = await s.ctx.cookies(GOOGLE_ADS_URL);
  return new Set(cookies.map((c) => c.name));
}

/** Google's signed-in session: its SID cookie in any of its forms. */
function signedIn(names) {
  return (
    names.has('SID') ||
    names.has('__Secure-1PSID') ||
    names.has('__Secure-3PSID')
  );
}

console.log(
  `[google-ads-login] profile=${USER_DATA_DIR} viewport=${process.env.WELES_VIEWPORT}`,
);
assertGoogleAdsProfileNotAlreadyOpen(USER_DATA_DIR, 'google_ads_login');
const s = await WSession.start({
  label: 'google_ads_login',
  proxy: statedProxy('the Google Ads login'),
  persona: stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
});

try {
  await bringBrowserToFront(s);
  await s.goto(GOOGLE_ADS_URL);
  await pageSettled(s.page);
  if (!signedIn(await adsCookieNames(s)) || onSignInPage(s.page.url())) {
    console.log(
      `[google-ads-login] running automated Google SSO for ${GOOGLE_ADS_LOGIN.email} source=skarbiec`,
    );
    if (!(await googleSso(s, { ...GOOGLE_ADS_LOGIN, source: 'skarbiec' })))
      throw new Error(
        `GOOGLE_ADS_SSO_INCOMPLETE: automated Google SSO did not complete (url=${s.page.url()})`,
      );
    await dismissGooglePostLogin(s.page);
    await s.goto(GOOGLE_ADS_URL);
    await pageSettled(s.page);
  }
  const names = await adsCookieNames(s);
  console.log(
    `[google-ads-login] cookie names: ${Array.from(names).sort().join(', ')}`,
  );
  if (!signedIn(names))
    throw new Error(
      `GOOGLE_ADS_LOGIN_NOT_PERSISTED: the profile holds no Google session cookie for Ads (url=${s.page.url()})`,
    );
  console.log('PASS: Google Ads login persisted');
} finally {
  if (closeAllowedByEnv('GOOGLE_ADS_LOGIN_CLOSE_AFTER'))
    await closeGoogleAdsSession(s, 'google-ads-login');
  else console.log('[google-ads-login] leaving Google Ads profile open');
}
