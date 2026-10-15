// Apple Ads API client setup probe.
//
// Opens Apple Ads Account Settings/API only through an already authenticated session.
// Authentication is delegated exclusively to an explicitly authorized apple_login run.
// Whether a page is the API settings page, and the settings and API entries
// themselves, are judged and found by the vision model
// (`_shared/page/judged/seen.mjs`) rather than matched against label words.
// Every refusal is thrown with its cause, so the run fails with it.

import { existsSync } from 'node:fs';
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  PRIVATE_KEY_PATH,
  PUBLIC_KEY_PATH,
  USER_DATA_DIR,
} from './api_client_setup_probe/settings.mjs';
import {
  keepOpen,
  pageDiag,
  requireAuthenticatedSession,
} from './api_client_setup_probe/page.mjs';
import { inspectExistingAppleAdsApi } from './api_client_setup_probe/artifacts.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';

const INDENT = '  ';
const APPLE_ADS_HOST = 'app-ads.apple.com';
const APPLE_ADS_HOME = `https://${APPLE_ADS_HOST}/cm/app/`;
// Where Apple Ads has placed the API settings: tried in order until the
// vision model sees the API settings page.
const API_SETTINGS_PAGES = [
  `${APPLE_ADS_HOME}account/settings/api`,
  `${APPLE_ADS_HOME}settings/api`,
  `${APPLE_ADS_HOME}account/settings`,
];

/** Whether the page is the Apple Ads API settings page. */
function onApiSettings(page) {
  return pageShows(
    page,
    'Is this the Apple Ads API settings page, showing API client credentials or asking for a public key?',
  );
}

/** A diagnostics label naming the page's path. */
function pathLabel(url) {
  return `url${new URL(url).pathname.replaceAll('/', '_')}`;
}

const acct = await getSocialAccount('apple');
if (!acct) {
  throw new Error(
    'APPLE_ACCOUNT_REQUIRED: no active apple account in the accounts store',
  );
}
const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'apple_ads_api_setup',
  browser: 'chromium',
  proxy:
    proxyUrl ??
    statedProxy('the Apple Ads API setup, whose account names no proxy,'),
  persona: persona ?? stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
});

let loggedIn = false;
try {
  console.log(
    JSON.stringify(
      {
        publicKeyPath: PUBLIC_KEY_PATH,
        hasPublicKey: existsSync(PUBLIC_KEY_PATH),
        privateKeyPath: PRIVATE_KEY_PATH,
        hasPrivateKey: existsSync(PRIVATE_KEY_PATH),
      },
      null,
      INDENT,
    ),
  );

  await s.goto(APPLE_ADS_HOME);
  await pageSettled(s.page);
  loggedIn = await requireAuthenticatedSession(s);
  if (!loggedIn) {
    throw new Error(
      `APPLE_ADS_NOT_SIGNED_IN: the Apple Ads session is not signed in (page ${s.page.url()}); run an explicitly authorized apple_login first`,
    );
  }
  await pageDiag(s.page, 'home');

  for (const url of API_SETTINGS_PAGES) {
    await s.goto(url);
    await pageSettled(s.page);
    await pageDiag(s.page, pathLabel(url));
    if (await onApiSettings(s.page)) break;
  }

  if (!(await onApiSettings(s.page))) {
    await s.goto(APPLE_ADS_HOME);
    await pageSettled(s.page);
    await clickDescribed(
      s.page,
      'the account settings entry of the Apple Ads account menu',
    );
    await clickDescribed(s.page, 'the API tab of the Apple Ads account settings');
  }
  const finalState = await pageDiag(s.page, 'final');
  const existing = await inspectExistingAppleAdsApi(s.page, finalState);

  // Apple signs in on its own identity host, so a page still on the Apple
  // Ads host after the checks above is a signed-in one.
  if (new URL(s.page.url()).hostname !== APPLE_ADS_HOST) {
    throw new Error(
      `APPLE_ADS_NOT_SIGNED_IN: the API page left the Apple Ads host for ${s.page.url()}; run an explicitly authorized apple_login before retrying`,
    );
  }
  if (existing.hasExistingAppleAdsApiClient) {
    console.log('PASS: Apple Ads API credential page reached');
  } else if (existing.canGenerateApiClient || existing.hasAppleAdsApiSurface) {
    console.log('PASS: Apple Ads API setup form reached');
  } else {
    throw new Error(
      `APPLE_ADS_API_PAGE_NOT_REACHED: neither API credentials nor the setup form were found at ${s.page.url()}`,
    );
  }
} finally {
  await keepOpen(s, loggedIn);
}
