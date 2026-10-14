// Create an Apple Push Notifications service (APNs) auth key in the Apple Developer
// portal using the persisted asc-profile session (cookies from the user's earlier
// login). Apple has no API for APNs keys and the user won't do a fresh login, so
// we reuse the saved cookies. Captures the one-time .p8 download. Never closes.
//   node src/trajectories/apple/apns/create_apns_key.mjs
import { WSession } from '../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { homedir } from 'node:os';
import { statedText } from '../../_shared/inputs/stated.mjs';

const ADD_URL = 'https://developer.apple.com/account/resources/authkeys/add';
const OUT_DIR = `${homedir()}/.swiatowid`;
const KEY_NAME = statedText(
  ['APNS_KEY_NAME'],
  'the name the new APNs key is given in the Apple Developer portal',
);

async function clickText(page, rx) {
  for (const loc of [
    page.getByRole('button', { name: rx }).first(),
    page.getByRole('link', { name: rx }).first(),
    page.getByText(rx).first(),
  ]) {
    if ((await loc.count()) > 0) {
      await humanClickLocator(page, loc);
      return true;
    }
  }
  return false;
}

const s = await WSession.start({
  label: 'create_apns_key',
  userDataDir: `${OUT_DIR}/asc-profile`,
  headless: false,
});

await s.goto(ADD_URL);
await pageSettled(s.page);
const landed = new URL(s.page.url());
if (
  landed.hostname.startsWith('idmsa.') ||
  landed.pathname.includes('/login') ||
  landed.searchParams.get('authResult') === 'FAILED'
) {
  throw new Error(
    `NEED_LOGIN: the persisted Apple session expired; the key cannot be created without a fresh apple_login (landed on ${s.page.url()})`,
  );
} else {
  console.log('[apns] on add page, logged in');
  // Arm the download capture before any clicks, so a flaky selector never loses the key.
  const downloadPromise = s.page.waitForEvent('download');
  // A step that fails ends the run with the step's error and the page it was
  // on; nothing waits for someone to finish the flow in the window.
  try {
    await s.page.waitForSelector('#name', { state: 'visible' });
    await humanFill(s.page, s.page.locator('#name').first(), KEY_NAME);
    await pageSettled(s.page);
    // Check the APNs service via its label (trusted event enables Continue).
    const lbl = s.page
      .locator('label')
      .filter({ hasText: 'Apple Push Notifications service (APNs)' })
      .first();
    if ((await lbl.count()) > 0) {
      await humanClickLocator(s.page, lbl);
    }
    await pageSettled(s.page);
    await clickText(s.page, /^continue$/i);
    await pageSettled(s.page);
    await clickText(s.page, /^register$/i);
    await pageSettled(s.page);
    const dl = await clickText(s.page, /download/i);
    console.log('[apns] download clicked =', dl);
  } catch (e) {
    throw new Error(
      `APNS_KEY_FLOW_FAILED on ${s.page.url()}: ${e.message}`,
      { cause: e },
    );
  }
  console.log('[apns] waiting for the .p8 download…');
  const download = await downloadPromise;
  const suggested = download.suggestedFilename(); // AuthKey_<KEYID>.p8
  const dest = `${OUT_DIR}/${suggested}`;
  await download.saveAs(dest);
  const keyId = suggested.replace(/^AuthKey_/, '').replace(/\.p8$/, '');
  console.log(`SAVED_P8=${dest}`);
  console.log(`APNS_KEY_ID=${keyId}`);
  console.log('PASS: APNs key downloaded — session left open.');
}
