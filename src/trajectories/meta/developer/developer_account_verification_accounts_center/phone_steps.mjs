// The phone steps: sending the number, updating a stored one, and confirming
// the code. Every control - the country selector and the country, Send
// Verification SMS, Update Mobile Number, Continue - is found by the vision
// model from its description (`_shared/page/judged/seen.mjs`), in the
// language the account's Meta pages speak. A field that does not hold what was
// typed, or a control that is not there, fails the step by name.
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
import { USER_DATA_DIR, VERIFY_CODE, VERIFY_PHONE } from './settings.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { phoneCountry, phoneNationalNumber, snapshot } from './page.mjs';

const INDENT = '  ';
const UNKNOWN_COUNTRY = 'unknown';

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

/** The digits `input` holds. */
async function heldDigits(input) {
  return (await input.inputValue()).replace(/\D/g, '');
}

/** Clicks `input`, replaces what it holds with `text`, and returns the digits it then holds. */
async function typeInto(page, input, text) {
  await humanClickLocator(page, input);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, text);
  await pageSettled(page);
  return heldDigits(input);
}

/** Picks the country of `phone` in the number field's country selector. */
async function selectCountryForPhone(page, phone) {
  const code = phoneCountry(phone);
  if (code === UNKNOWN_COUNTRY) return;
  await clickControl(
    page,
    'country_selector',
    'the country code selector of the mobile number field',
  );
  await clickControl(
    page,
    'country',
    `the country whose dialling code is ${code} in the open country list`,
  );
  await snapshot(page, 'after_country_select');
}

export async function fillPhoneAndSend(page) {
  if (!VERIFY_PHONE) return { filled: false, clicked: false };
  await selectCountryForPhone(page, VERIFY_PHONE);
  const input = page
    .locator('input[type="tel"], input[autocomplete="tel"], input[type="text"]')
    .filter({ visible: true })
    .last();
  await input.waitFor({ state: 'visible' });
  const national = phoneNationalNumber(VERIFY_PHONE);
  const held = await typeInto(page, input, national);
  // A field that holds nothing, or other digits, would send Meta a number
  // nobody typed and the code would go elsewhere.
  if (held !== national)
    throw new Error(
      `developer phone field holds ${held.length} digits after typing ${national.length}; the number was not entered`,
    );
  console.log(
    JSON.stringify({ stage: 'filled_phone_input', valueLength: held.length }),
  );
  await clickControl(
    page,
    'send_verification_sms',
    'the enabled button that sends the verification SMS to the entered number',
  );
  return { filled: true, clicked: true };
}

export async function clickUpdateMobileNumber(page) {
  await clickControl(
    page,
    'update_mobile_number',
    'the enabled button that updates or changes the mobile number used for verification',
  );
  return true;
}

export async function fillCodeAndContinue(page) {
  if (!VERIFY_CODE) return { filled: false, clicked: false };
  const input = page.locator('input').filter({ visible: true }).last();
  await input.waitFor({ state: 'visible' });
  const held = await typeInto(page, input, VERIFY_CODE);
  if (held !== String(VERIFY_CODE).replace(/\D/g, ''))
    throw new Error(
      `developer code field holds ${held.length} digits, not the code typed; the code was not entered`,
    );
  await clickControl(
    page,
    'developer_code_continue',
    'the enabled button that continues after the verification code was entered',
  );
  return { filled: true, clicked: true };
}

const start = {
  stage: 'start',
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
};
console.log(JSON.stringify(start, null, INDENT));
