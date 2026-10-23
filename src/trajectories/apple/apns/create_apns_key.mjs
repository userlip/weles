// Create an Apple Push Notifications service (APNs) auth key in the Apple
// Developer portal with the kept Apple profile's session, and keep the .p8
// as the vault item playing the APNs key role: its key id and private key,
// read from the download in memory and never written to disk. Apple has no
// API for APNs keys. An expired session ends the run with NEED_LOGIN and a
// failed exit; a step the page does not offer ends it naming that step.
//
// Usage:
//   APNS_KEY_NAME=<name> node src/trajectories/apple/apns/create_apns_key.mjs

import { WSession } from '../../../../dist/session/wsession.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickOffered, pageShows } from '../../_shared/page/judged/seen.mjs';
import { keptProfileDir } from '../../_shared/profile/persona.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { assertScopedSecretWriter } from '../../../_shared/scoped-secrets.mjs';
import { keepDownloadedKey } from '../../_shared/apple/downloaded-key.mjs';

const SERVICE = 'appleApnsKey';
const ADD_URL = new URL(
  'https://developer.apple.com/account/resources/authkeys/add',
);
const KEY_NAME = statedText(
  ['APNS_KEY_NAME'],
  'the name the new APNs key is given in the Apple Developer portal',
);

/** Click the control `description` names, refusing the run when the page offers none. */
async function requireClick(page, description) {
  if (!(await clickOffered(page, description)))
    throw new Error(
      `APNS_KEY_FLOW_FAILED on ${page.url()}: the page offers no ${description}`,
    );
}

assertScopedSecretWriter(SERVICE);
const s = await WSession.start({
  label: 'create_apns_key',
  userDataDir: keptProfileDir('apple_app_store_connect'),
  headless: false,
});
try {
  await s.goto(ADD_URL.href);
  await pageSettled(s.page);
  const landed = new URL(s.page.url());
  if (
    landed.hostname !== ADD_URL.hostname ||
    !landed.pathname.startsWith(ADD_URL.pathname) ||
    (await pageShows(
      s.page,
      'Does the page ask to sign in to Apple, or for an Apple password or a two-factor verification code?',
    ))
  )
    throw new Error(
      `NEED_LOGIN: the kept Apple session cannot reach the key form (the browser shows ${landed.href}); the key cannot be created without a fresh apple_login`,
    );
  // Armed before the clicks, so the key is caught however quickly it arrives.
  const downloaded = s.page.waitForEvent('download');
  const name = s.page.getByRole('textbox').first();
  if (!(await name.count()))
    throw new Error(
      `APNS_KEY_FLOW_FAILED on ${s.page.url()}: the key name field is not shown`,
    );
  await humanFill(s.page, name, KEY_NAME);
  await pageSettled(s.page);
  await requireClick(
    s.page,
    'the checkbox that enables Apple Push Notifications service (APNs)',
  );
  await requireClick(s.page, 'the Continue button');
  await requireClick(s.page, 'the Register button');
  await requireClick(s.page, 'the control that downloads the key');
  const keyId = await keepDownloadedKey(await downloaded, SERVICE, {});
  console.log(`APNS_KEY_ID=${keyId}`);
  console.log(
    'PASS: the APNs key is kept in the vault; the browser window stays open',
  );
} catch (e) {
  console.log('FAIL:', e instanceof Error ? e.message : String(e));
  throw e;
}
