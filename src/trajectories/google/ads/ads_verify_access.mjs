// Google Ads browser access verifier.
//
// Reuses the persistent Weles Google Ads profile and reports what the logged-in
// browser can see. This is intentionally browser-first so access can be checked
// even when REST credentials are absent or unavailable. Whether the profile is
// signed in is read by the shared Google session reader; a signed-out profile
// fails the run with the address it landed on.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  assertGoogleAdsProfileNotAlreadyOpen,
  closeAllowedByEnv,
} from './_profile_guard.mjs';
import { closeGoogleAdsSession } from './_close_session.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';
import {
  holdsGoogleSession,
  onGoogleSignIn,
} from '../../_shared/profile/google_session.mjs';
import { profileForCheck } from '../../_shared/profile/clone.mjs';

const INDENT = '  ';
const GOOGLE_ADS_CAMPAIGNS = 'https://ads.google.com/aw/campaigns';
const SOURCE_USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'google_ads');
const WAIT_FOR_LOGIN = process.env.WAIT_FOR_LOGIN === '1';
const STATED_CUSTOMER =
  process.env.GOOGLE_ADS_CUSTOMER_ID || process.env.CUSTOMER_ID;
const CUSTOMER_ID = STATED_CUSTOMER
  ? STATED_CUSTOMER.replace(/\D/g, '')
  : null;
const USE_PROFILE_CLONE = process.env.GOOGLE_VERIFY_USE_PROFILE_CLONE !== '0';
mkdirSync(SOURCE_USER_DATA_DIR, { recursive: true });

function targetUrl() {
  if (process.env.ADS_URL) return process.env.ADS_URL;
  if (!CUSTOMER_ID) return GOOGLE_ADS_CAMPAIGNS;
  return `${GOOGLE_ADS_CAMPAIGNS}?ocid=${encodeURIComponent(CUSTOMER_ID)}`;
}

/** What the signed-in Google Ads page shows: its title, headings and rows. */
function pageDetails() {
  const squash = (node) => node.innerText.replace(/\s+/g, ' ').trim();
  return {
    title: document.title,
    headings: Array.from(document.querySelectorAll('h1, h2, [role="heading"]'))
      .map(squash)
      .filter(Boolean),
    rows: Array.from(
      document.querySelectorAll('[role="row"], material-list-item, tr'),
    )
      .map(squash)
      .filter(Boolean),
  };
}

assertGoogleAdsProfileNotAlreadyOpen(
  SOURCE_USER_DATA_DIR,
  'google_ads_verify_access',
);
const preparedProfile = profileForCheck(
  SOURCE_USER_DATA_DIR,
  'google-verify',
  USE_PROFILE_CLONE,
);
console.log(
  `[google-ads-verify-access] sourceProfile=${SOURCE_USER_DATA_DIR} clonedProfile=${USE_PROFILE_CLONE} customer=${CUSTOMER_ID ? CUSTOMER_ID : 'not stated'}`,
);
const s = await WSession.start({
  label: 'google_ads_verify_access',
  proxy: statedProxy('the Google Ads access check'),
  persona: stableProfilePersona(SOURCE_USER_DATA_DIR),
  userDataDir: preparedProfile.dir,
  headless: process.env.GOOGLE_VERIFY_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

try {
  await s.goto(targetUrl());
  await pageSettled(s.page);
  if (WAIT_FOR_LOGIN) {
    await s.page.waitForURL((u) => !onGoogleSignIn(String(u)));
    await pageSettled(s.page);
  }

  const current = s.page.url();
  if (
    onGoogleSignIn(current) ||
    !(await holdsGoogleSession(s.ctx, GOOGLE_ADS_CAMPAIGNS))
  ) {
    throw new Error(
      `GOOGLE_ADS_NOT_SIGNED_IN: the Google Ads browser session is not signed in (url=${current})`,
    );
  }
  const parsed = new URL(current);
  console.log(
    JSON.stringify(
      {
        platform: 'google_ads',
        loggedIn: true,
        selectedCustomer: CUSTOMER_ID
          ? CUSTOMER_ID
          : (parsed.searchParams.get('ocid') ??
            parsed.searchParams.get('customerId')),
        url: current,
        ...(await s.page.evaluate(pageDetails)),
      },
      null,
      INDENT,
    ),
  );
  console.log('PASS: Google Ads browser access verified');
} finally {
  if (!USE_PROFILE_CLONE && !closeAllowedByEnv('GOOGLE_VERIFY_CLOSE_AFTER'))
    console.log('[google-ads-verify-access] leaving Google Ads profile open');
  else await closeGoogleAdsSession(s, 'google-ads-verify-access');
  preparedProfile.cleanup();
}
