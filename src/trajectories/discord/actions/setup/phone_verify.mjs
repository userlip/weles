// Discord phone-verify trajectory. Setup-tier verb that unblocks every
// server-interaction endpoint behind Discord's 40002 wall. Drives the
// SPA path (NOT raw API — the earlier API-only attempt in
// lib/discord_harvest.mjs hit VOIP-detection 50022 rejections; the SPA
// path carries full XHR headers + the in-page hCaptcha challenge that
// register already proved solvable for this account on this IP).
//
// Sequence:
//   1. Source account, start WSession, addInitScript-inject discord_token.
//   2. Navigate /channels/@me, open User Settings via gear button.
//   3. Click the Phone Number row's Add button on My Account.
//   4. Rent a number in DISCORD_PHONE_COUNTRY (required; the run refuses
//      without it) via getNumber('discord', country) and fill it.
//   5. Click Send to dispatch the SMS. Discord renders in-page hCaptcha
//      challenge — solve via solvePageCaptcha (the keeper-validated
//      register path works because the SPA carries full fingerprint).
//   6. Read the juicysms order once via readCode; no code yet is a named error.
//   7. Fill the verification code modal, click Verify.
//   8. Assert the Phone Number row now shows the country-prefixed number.
//   9. Persist metadata.phone_verified_at + metadata.phone.

import { WSession } from '../../../../../dist/session/wsession.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../dist/human/keyboard.js';
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../../dist/utils/credentials.js';
import {
  getNumber,
  readCode,
  cancelOrder,
} from '../../../../../dist/utils/identity/sms.js';
import { statedText } from '../../../_shared/inputs/stated.mjs';

const ACCT_USERNAME = process.env.ACCOUNT_USERNAME;
// The number is bought, and tied to the account, in this country.
const COUNTRY = statedText(
  ['DISCORD_PHONE_COUNTRY'],
  'the country the SMS number is rented in and the account is verified with',
);

const acct = ACCT_USERNAME
  ? await getSocialAccount('discord', { username: ACCT_USERNAME })
  : await getSocialAccount('discord');
if (!acct) {
  console.log('FAIL: no discord account');
  process.exit(1);
}
const token = acct.metadata?.discord_token;
if (!token) {
  console.log(`FAIL: ${acct.username} metadata.discord_token missing`);
  process.exit(1);
}

const opts = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'discord_phone_verify',
  proxy: opts.proxyUrl,
  persona: opts.persona,
  targetHost: 'discord.com',
});
console.log(`[phone_verify] account=${acct.username} country=${COUNTRY}`);

let num = null;
try {
  await s.ctx.addInitScript(
    `(()=>{try{if(location.hostname.indexOf('discord')>=0){localStorage.setItem('token',JSON.stringify(${JSON.stringify(token)}))}}catch(e){}})()`,
  );
  await s.goto('https://discord.com/channels/@me');
  await humanIdlePause('deliberate');

  const gear = s.page.locator('button[aria-label="User Settings"]').first();
  await humanClickLocator(s.page, gear);
  await humanIdlePause('deliberate');

  // Click Phone Number row's Add button.
  const phoneRow = s.page
    .locator('div')
    .filter({ hasText: /^Phone Number$/ })
    .first();
  if ((await phoneRow.count()) === 0)
    throw new Error('Phone Number row not found in My Account');
  // The Add button is typically the closest sibling button with text "Add"
  const addBtn = s.page.locator('button').filter({ hasText: /^Add$/ }).first();
  if ((await addBtn.count()) === 0)
    throw new Error('Add button next to Phone Number not found');
  await humanClickLocator(s.page, addBtn);
  await humanIdlePause('deliberate');

  // Get a number from juicysms
  num = await getNumber('discord', COUNTRY);
  if (!num) throw new Error(`no ${COUNTRY} number available from juicysms`);
  console.log(
    `[phone_verify] number=${num.phone} order=${num.orderId} provider=${num.provider}`,
  );

  // Fill the phone input. Discord shows a country picker then a number
  // input. The combined input often accepts the full +E.164 number.
  const phoneInput = s.page
    .locator(
      'input[type="tel"], input[placeholder*="phone"], input[placeholder*="Phone"]',
    )
    .first();
  if ((await phoneInput.count()) === 0)
    throw new Error('phone input not found in the Add modal');
  // strip + for fill (Discord's input strips the country-code lead);
  // humanFill clears+types.
  await humanFill(s.page, phoneInput, num.phone.replace(/^\+/, ''));
  await humanIdlePause('short');

  // The phone field submits the modal on Enter.
  await phoneInput.press('Enter');
  await humanIdlePause('deliberate');

  // hCaptcha may render now. solvePageCaptcha handles both invisible and
  // visible variants of the SPA-rendered widget.
  try {
    const { solvePageCaptcha } = await import(
      '../../../../../dist/captcha/detect.js'
    );
    const captchaResult = await solvePageCaptcha(s.page, undefined, s);
    if (captchaResult) console.log(`[phone_verify] captcha solved`);
  } catch (e) {
    console.log(`[phone_verify] captcha attempt err: ${e.message}`);
  }

  // One read of the SMS order; a code that has not arrived is a named error.
  const code = await readCode(num.orderId, num.provider);
  console.log(`[phone_verify] received SMS code: ${code}`);

  // Fill the verification code modal.
  const codeInput = s.page
    .locator(
      'input[placeholder*="code"], input[autocomplete="one-time-code"], input[maxlength="6"]',
    )
    .first();
  if ((await codeInput.count()) === 0)
    throw new Error('SMS code input not found');
  await humanFill(s.page, codeInput, code);
  await humanIdlePause('short');
  await codeInput.press('Enter');
  await humanIdlePause('deliberate');

  // Assert phone now appears on the Phone Number row.
  const phoneRow2 = s.page
    .locator('div')
    .filter({ hasText: new RegExp(num.phone.replace(/^\+/, '').slice(-7)) })
    .first();
  if ((await phoneRow2.count()) === 0)
    throw new Error(
      'phone number not visible on My Account after verify — likely rejected (VOIP, invalid, etc.)',
    );
  console.log('[phone_verify] phone visible on My Account — verify complete');

  if (!acct.id) throw new Error('Discord account has no Skarbiec item id');
  await s.patchAccount(acct.id, {
    metadata: {
      phone: num.phone,
      phone_verified_at: new Date().toISOString(),
      phone_country: COUNTRY,
    },
  });
  console.log('[phone_verify] persisted phone state to Skarbiec');
  console.log(`PASS: ${acct.username} phone verified ${num.phone}`);
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  if (num) {
    try {
      await cancelOrder(num.orderId, num.provider);
    } catch (ce) {
      console.log(`[phone_verify] cancel err: ${ce.message}`);
    }
  }
  process.exitCode = 1;
} finally {
  await s.close();
}
process.exit(process.exitCode);
