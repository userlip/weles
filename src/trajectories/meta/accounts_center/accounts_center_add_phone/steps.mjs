// The phone steps: pressing a described control, the phone and code fields,
// and the account chooser. Every control is found by the vision model from
// its description (`_shared/page/judged/seen.mjs`), in the account's language.
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
import { USER_DATA_DIR, VERIFY_CODE, VERIFY_PHONE } from './settings.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import {
  clickDescribed,
  pageShows,
} from '../../../_shared/page/judged/seen.mjs';

const INDENT = '  ';

/** Clicks the control `description` names; throws when the page has none. */
export async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

/**
 * Clicks the control `description` names when the page shows what `question`
 * asks about; says whether it did.
 */
export async function clickWhenShown(page, label, question, description) {
  if (!(await pageShows(page, question))) return false;
  await clickControl(page, label, description);
  return true;
}

/** The button that sends the open phone or code form. */
export const SUBMIT_FORM =
  'the enabled button that sends the open phone number or confirmation code form';

/** The digits of `text`; Meta formats a phone field as it is typed. */
function digits(text) {
  return String(text).replace(/\D/g, '');
}

/** Type `text` into `input` and confirm the field holds it. A click, select
 * or keystroke that failed used to be dropped, and the step logged the field
 * as filled while it held nothing or the old value. */
async function typeInto(page, input, text, stage) {
  await humanClickLocator(page, input);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, text);
  await pageSettled(page);
  const held = await input.inputValue();
  if (!digits(held).endsWith(digits(text)))
    throw new Error(
      `${stage}: the field holds ${digits(held).length} digits, not the ${digits(text).length} typed`,
    );
  console.log(JSON.stringify({ stage, redacted: true }));
  return true;
}

// The phone field is the form's telephone input, or its one text input when
// the form does not declare the type.
export async function fillPhone(page) {
  const input = await page
    .locator('input[type="tel"], input[autocomplete="tel"], input[type="text"]')
    .filter({ visible: true })
    .last();
  if (!(await input.isVisible())) return false;
  return typeInto(page, input, VERIFY_PHONE, 'filled_phone');
}

export async function fillCode(page) {
  if (!VERIFY_CODE) return false;
  const input = page.locator('input').filter({ visible: true }).last();
  if (!(await input.isVisible())) return false;
  return typeInto(page, input, VERIFY_CODE, 'filled_code');
}

/**
 * Picks the Facebook account the phone number is added to, when the form asks
 * which account it is for; Accounts Center lists the accounts of the signed-in
 * person, so the account is the Facebook one among them.
 */
export function selectPhoneAssociationAccount(page) {
  return clickWhenShown(
    page,
    'select_phone_association_account',
    'Does the form ask which account the phone number should be added to?',
    'the Facebook account option in the list of accounts the phone number is added to',
  );
}

const start = {
  stage: 'start',
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
};
console.log(JSON.stringify(start, null, INDENT));
