import { pageSettled } from '../../_shared/page/settled.mjs';
// Generate an App Store Connect API key through an already authenticated persistent profile.
// Authentication is delegated exclusively to an explicitly authorized apple_login run.
//
// Usage:
//   node src/trajectories/apple/asc/asc_create_api_key.mjs
import { WSession } from '../../../../dist/session/wsession.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { clickOffered } from '../../_shared/page/judged/seen.mjs';
import { homedir } from 'node:os';
import { statedText } from '../../_shared/inputs/stated.mjs';

async function requireAuthenticatedSession(s) {
  await pageSettled(s.page);
  const landed = new URL(s.page.url());
  // Apple's sign-in lives on its identity hosts or a /login route.
  const loginUrl =
    ['idmsa.apple.com', 'appleid.apple.com'].includes(landed.hostname) ||
    landed.pathname.startsWith('/login');
  const authIframe =
    (await s.page
      .locator(
        'iframe[src*="idmsa.apple.com"], iframe[src*="appleid.apple.com"]',
      )
      .count()) > 0;
  let authPrompt = false;
  for (const frame of s.page.frames()) {
    authPrompt ||= await frame
      .locator(
        [
          '#account_name_text_field',
          '#password_text_field',
          'input[type="password"]',
          'input[aria-label*="digit"]',
          'input[aria-label*="Digit"]',
          'input[type="tel"][maxlength="1"]',
        ].join(', '),
      )
      .first()
      .isVisible()
      .catch(() => false);
    if (authPrompt) break;
  }
  if (loginUrl || authIframe || authPrompt) {
    throw new Error(
      'FAIL_CLOSED: Apple login/password/2FA is required; this trajectory will not authenticate. An explicitly authorized apple_login is the only permitted login path.',
    );
  }
}

const API_URL = 'https://appstoreconnect.apple.com/access/integrations/api';
const KEY_NAME = statedText(
  ['KEY_NAME'],
  'the name the new App Store Connect API key is given',
);
const OUT_DIR = `${homedir()}/.swiatowid`;

async function requireApiPage(s) {
  await requireAuthenticatedSession(s);
  let parsedUrl = new URL(s.page.url?.() || 'about:blank');
  const authenticatedHost =
    parsedUrl.hostname === 'appstoreconnect.apple.com' &&
    !parsedUrl.pathname.startsWith('/login');
  if (
    authenticatedHost &&
    !parsedUrl.pathname.startsWith('/access/integrations/api')
  ) {
    await s.goto(API_URL);
    await pageSettled(s.page);
    await requireAuthenticatedSession(s);
    parsedUrl = new URL(s.page.url?.() || 'about:blank');
  }
  if (
    parsedUrl.hostname !== 'appstoreconnect.apple.com' ||
    !parsedUrl.pathname.startsWith('/access/integrations/api')
  ) {
    throw new Error(
      'FAIL_CLOSED: authenticated App Store Connect API integrations page was not confirmed; run an explicitly authorized apple_login before retrying.',
    );
  }
  console.log(`[asc-create] strona API — ${parsedUrl.href}`);
}

async function clickGenerate(page) {
  const clickables = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll(
        'button, a, [role="button"], [role="menuitem"]',
      ),
    ];
    return [
      ...new Set(
        els
          .map((e) =>
            (e.getAttribute('aria-label') || e.textContent || '')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .filter(Boolean),
      ),
    ];
  });
  console.log(
    '[asc-create] klikalne na stronie: ' + JSON.stringify(clickables),
  );

  const opened = await clickOffered(
    page,
    'the control that generates a new API key',
  );
  console.log('[asc-create] generate-open=' + opened);
  await pageSettled(page);

  const name = page.getByRole('textbox').first();
  if ((await name.count()) > 0) {
    await humanFill(page, name, KEY_NAME);
    await pageSettled(page);
  }
  await clickOffered(page, 'the App Manager access option');
  await pageSettled(page);
  await clickOffered(page, 'the button that generates the key');
  await pageSettled(page);
  const dl = await clickOffered(page, 'the control that downloads the API key');
  console.log('[asc-create] download=' + dl);
}

const s = await WSession.start({
  label: 'asc_create_api_key',
  userDataDir: `${OUT_DIR}/asc-profile`,
  headless: false,
});
try {
  await s.goto(API_URL);
  await requireApiPage(s);
  await pageSettled(s.page);

  // Arm the download capture before the clicks so the key is caught however
  // quickly it arrives. A step that fails ends the run with its error and the
  // page it was on; nothing waits for someone to finish it in the window.
  const downloadPromise = s.page.waitForEvent('download');
  try {
    await clickGenerate(s.page);
  } catch (e) {
    throw new Error(
      `ASC_API_KEY_FLOW_FAILED on ${s.page.url()}: ${e.message}`,
      { cause: e },
    );
  }

  console.log('[asc-create] waiting for the .p8 download');
  const download = await downloadPromise;
  const suggested = download.suggestedFilename(); // AuthKey_<KEYID>.p8
  const dest = `${OUT_DIR}/${suggested}`;
  await download.saveAs(dest);
  const keyId = suggested.replace(/^AuthKey_/, '').replace(/\.p8$/, '');
  console.log(`SAVED_P8=${dest}`);
  console.log(`KEY_ID=${keyId}`);
  console.log(
    'PASS: API key downloaded — OKNO ZOSTAJE OTWARTE (świadomie nie zamykam sesji).',
  );
  // Deliberately NOT closing: the live, logged-in window stays open so the
  // session is never thrown away again. The .p8 is already saved to disk and the
  // key id is printed above, so the result is captured without tearing down.
} catch (e) {
  console.log('FAIL:', e.message);
  // No teardown on failure either — leave the window so you can finish
  // manually; the error is rethrown so the run exits failed instead of
  // reading as success to its caller.
  throw e;
}
