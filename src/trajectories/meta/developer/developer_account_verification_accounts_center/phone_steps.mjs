// The phone steps: sending the number, updating a stored one, and confirming
// the code. Every control - the country selector and the country, Send
// Verification SMS, Update Mobile Number, Continue - is found by the vision
// model from its description (`_shared/page/judged/seen.mjs`), in the
// language the account's Meta pages speak. A field that does not hold what was
// typed, or a control that is not there, fails the step by name. Each step's
// page state is kept with the run (`_shared/diagnostics/page_state.mjs`).
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
import { VERIFY_CODE } from './settings.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { recordPageState } from '../../../_shared/diagnostics/page_state.mjs';

export const RUN = 'meta_developer_account_verification_accounts_center';

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

/** Clicks `input`, replaces what it holds with `text`, and returns the digits it then holds. */
async function typeInto(page, input, text) {
  await humanClickLocator(page, input);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, text);
  await pageSettled(page);
  return (await input.inputValue()).replace(/\D/g, '');
}

/**
 * Pick `phone`'s dialling code in the number field's country selector, type
 * its national number, and send the verification SMS. A field that then holds
 * other digits would send Meta a number nobody typed, so it fails the step.
 */
export async function fillPhoneAndSend(page, phone) {
  await clickControl(
    page,
    'country_selector',
    'the country code selector of the mobile number field',
  );
  await clickControl(
    page,
    'country',
    `the country whose dialling code is +${phone.countryCode} in the open country list`,
  );
  await recordPageState(page, RUN, 'after_country_select');
  const input = page
    .locator('input[type="tel"], input[autocomplete="tel"], input[type="text"]')
    .filter({ visible: true })
    .last();
  await input.waitFor({ state: 'visible' });
  const held = await typeInto(page, input, phone.national);
  if (held !== phone.national)
    throw new Error(
      `developer phone field holds ${held.length} digits after typing ${phone.national.length}; the number was not entered`,
    );
  console.log(
    JSON.stringify({ stage: 'filled_phone_input', valueLength: held.length }),
  );
  await clickControl(
    page,
    'send_verification_sms',
    'the enabled button that sends the verification SMS to the entered number',
  );
}

export async function clickUpdateMobileNumber(page) {
  await clickControl(
    page,
    'update_mobile_number',
    'the enabled button that updates or changes the mobile number used for verification',
  );
}

/** Type the stated code and continue; the field must then hold its digits. */
export async function fillCodeAndContinue(page) {
  const input = page.locator('input').filter({ visible: true }).last();
  await input.waitFor({ state: 'visible' });
  const held = await typeInto(page, input, VERIFY_CODE);
  if (held !== VERIFY_CODE.replace(/\D/g, ''))
    throw new Error(
      `developer code field holds ${held.length} digits, not the code typed; the code was not entered`,
    );
  await clickControl(
    page,
    'developer_code_continue',
    'the enabled button that continues after the verification code was entered',
  );
}
