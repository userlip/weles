// Generate an App Store Connect API key through an already authenticated
// persistent profile and keep it as the vault item playing the App Store
// Connect API role: the key id, the issuer id the page shows and the .p8
// private key, read from the download in memory and never written to disk.
// Authentication is delegated to an explicitly authorized apple_login run;
// a sign-in, password or code prompt ends this run.
//
// Usage:
//   KEY_NAME=<name> node src/trajectories/apple/asc/asc_create_api_key.mjs

import { WSession } from '../../../../dist/session/wsession.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  clickOffered,
  pageShows,
  shownText,
} from '../../_shared/page/judged/seen.mjs';
import { keptProfileDir } from '../../_shared/profile/persona.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { assertScopedSecretWriter } from '../../../_shared/scoped-secrets.mjs';
import { keepDownloadedKey } from '../../_shared/apple/downloaded-key.mjs';

const SERVICE = 'appleAppStoreConnectApi';
const API_URL = new URL(
  'https://appstoreconnect.apple.com/access/integrations/api',
);
/** The hosts Apple serves its sign-in from. */
const APPLE_SIGN_IN_HOSTS = Object.freeze({
  'idmsa.apple.com': true,
  'appleid.apple.com': true,
});
const KEY_NAME = statedText(
  ['KEY_NAME'],
  'the name the new App Store Connect API key is given',
);

/** Refuse a page that is asking to sign in: this trajectory never authenticates. */
async function requireAuthenticatedSession(page) {
  const landed = new URL(page.url());
  const signingIn =
    Object.hasOwn(APPLE_SIGN_IN_HOSTS, landed.hostname) ||
    landed.pathname.startsWith('/login') ||
    (await pageShows(
      page,
      'Does the page ask to sign in to Apple, or for an Apple password or a two-factor verification code?',
    ));
  if (signingIn)
    throw new Error(
      `FAIL_CLOSED: ${landed.href} asks for an Apple sign-in, password or code; this trajectory will not authenticate. An explicitly authorized apple_login is the only permitted login path.`,
    );
}

/** Open the API integrations page and confirm it is the one shown. */
async function requireApiPage(s) {
  await s.goto(API_URL.href);
  await pageSettled(s.page);
  await requireAuthenticatedSession(s.page);
  const shown = new URL(s.page.url());
  if (
    shown.hostname !== API_URL.hostname ||
    !shown.pathname.startsWith(API_URL.pathname)
  )
    throw new Error(
      `FAIL_CLOSED: the App Store Connect API integrations page was not reached (the browser shows ${shown.href}); run an explicitly authorized apple_login before retrying.`,
    );
  console.log(`[asc-create] API page ${shown.href}`);
}

/** Click the control `description` names, refusing the run when the page offers none. */
async function requireClick(page, description) {
  if (!(await clickOffered(page, description)))
    throw new Error(
      `ASC_API_KEY_FLOW_FAILED on ${page.url()}: the page offers no ${description}`,
    );
}

/** Generate the key with App Manager access and start its download. */
async function generateKey(page) {
  await requireClick(page, 'the control that generates a new API key');
  const name = page.getByRole('textbox').first();
  if (!(await name.count()))
    throw new Error(
      `ASC_API_KEY_FLOW_FAILED on ${page.url()}: the new key's name field is not shown`,
    );
  await humanFill(page, name, KEY_NAME);
  await pageSettled(page);
  await requireClick(page, 'the App Manager access option');
  await requireClick(page, 'the button that generates the key');
  await requireClick(page, 'the control that downloads the API key');
}

assertScopedSecretWriter(SERVICE);
const s = await WSession.start({
  label: 'asc_create_api_key',
  userDataDir: keptProfileDir('apple_app_store_connect'),
  headless: false,
});
try {
  await requireApiPage(s);
  const issuerId = await shownText(
    s.page,
    'Issuer ID of this team’s App Store Connect API keys',
  );
  if (!issuerId)
    throw new Error(
      `ASC_ISSUER_ID_NOT_SHOWN on ${s.page.url()}: the page shows no Issuer ID, which the key is used with`,
    );
  // Armed before the clicks, so the key is caught however quickly it arrives.
  const downloaded = s.page.waitForEvent('download');
  await generateKey(s.page);
  const keyId = await keepDownloadedKey(await downloaded, SERVICE, {
    issuer_id: issuerId,
  });
  console.log(`KEY_ID=${keyId}`);
  console.log(`ISSUER_ID=${issuerId}`);
  console.log(
    'PASS: the App Store Connect API key is kept in the vault; the browser window stays open',
  );
} catch (e) {
  console.log('FAIL:', e instanceof Error ? e.message : String(e));
  throw e;
}
