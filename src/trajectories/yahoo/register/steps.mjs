// The steps of Yahoo's signup: the first form, and each step Yahoo may show
// after it (a phone, a code, a password, the control that opens password
// setup). Each step answers whether the page showed it; a step it shows but
// cannot complete throws with what was missing.
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { phoneForField } from '../../_shared/inputs/phone.mjs';

/** The first of `selectors` the page shows, or null. */
async function shown(page, selectors) {
  for (const selector of selectors) {
    const found = page.locator(selector).filter({ visible: true }).first();
    if (await found.count()) return found;
  }
  return null;
}

/** Type `value` into the first field of `selectors` the page shows; refused when none is. */
async function fillRequired(page, selectors, value, what) {
  const field = await shown(page, selectors);
  if (!field) throw new Error(`YAHOO_FIELD_MISSING: ${page.url()} shows no ${what} field`);
  await humanFill(page, field, value);
}

/** Submit the step the page shows, through its own submit control. */
async function submitStep(page) {
  const submit = await shown(page, ['form button[type="submit"]', 'button[name="signup"]']);
  if (submit) await humanClickLocator(page, submit);
  else await clickDescribed(page, 'the button that submits this signup step');
  await pageSettled(page);
}

/** The identity's birth date, read from its own month name, day and year; refused when it does not parse. */
function birthDate(id) {
  const born = new Date(`${id.birthMonth} ${id.birthDay}, ${id.birthYear}`);
  if (Number.isNaN(born.getTime()))
    throw new Error(`birth_date_unreadable: ${id.birthMonth} ${id.birthDay} ${id.birthYear}`);
  return born;
}

/**
 * Fill and submit the first form. Yahoo shows it with an email field (the
 * signup registers an existing address) or with a Yahoo user id; answers
 * which.
 */
export async function fillSignupForm(page, id) {
  const existingEmail = Boolean(await shown(page, ['input#reg-email', 'input[name="email"]']));
  await fillRequired(page, ['input#reg-firstName', 'input[name="firstName"]', 'input[autocomplete="given-name"]'], id.firstName, 'first name');
  await fillRequired(page, ['input#reg-lastName', 'input[name="lastName"]', 'input[autocomplete="family-name"]'], id.lastName, 'last name');
  if (existingEmail) {
    await fillRequired(page, ['input#reg-email', 'input[name="email"]'], id.email, 'email');
    await fillRequired(page, ['input#reg-birthYear', 'input[name="birthYear"]'], String(id.birthYear), 'birth year');
  } else {
    const born = birthDate(id);
    await fillRequired(page, ['input#reg-userId', 'input[name="userId"]'], id.username, 'user id');
    await fillRequired(page, ['input#reg-password', 'input[name="password"]', 'input[type="password"]'], id.password, 'password');
    await fillRequired(page, ['input[name="mm"]', 'input[id$="-mm"]'], born.toLocaleString('en', { month: '2-digit' }), 'birth month');
    await fillRequired(page, ['input[name="dd"]', 'input[id$="-dd"]'], born.toLocaleString('en', { day: '2-digit' }), 'birth day');
    await fillRequired(page, ['input[name="yyyy"]', 'input[id$="-yyyy"]'], String(id.birthYear), 'birth year');
    const terms = await shown(page, ['input#checkTerms', 'input[name="checkTerms"]']);
    if (terms && !(await terms.isChecked())) await humanClickLocator(page, terms);
  }
  await submitStep(page);
  return existingEmail ? 'existing_email' : 'yahoo_address';
}

/**
 * A phone step: a number rented for Yahoo in the country its phone field is
 * set to (../../_shared/inputs/phone.mjs).
 */
export async function maybeHandlePhone(s) {
  const phone = await shown(s.page, ['input[type="tel"][name*="phone" i]', 'input[name*="phone" i]', 'input[id*="phone" i]']);
  if (!phone) return false;
  await humanFill(s.page, phone, await phoneForField(s, s.page, 'yahoo'));
  await submitStep(s.page);
  return true;
}

/**
 * A code step: the code Yahoo sent for this signup, to the email address
 * the form was given when it registered an existing address, to the phone
 * otherwise. The form variant decides it, not words on the code page. A
 * code is one run of letters and digits; any other answer is the reader's
 * own account of why it has none, and is refused with it.
 */
export async function maybeHandleCode(s, id, variant) {
  const field = await shown(s.page, ['input[autocomplete="one-time-code"]', 'input[name*="code" i]', 'input[id*="code" i]']);
  if (!field) return false;
  const viaEmail = variant === 'existing_email';
  const code = viaEmail ? await s.checkEmail(id.email, 'yahoo') : await s.pollSmsCode();
  if (!/^[A-Z\d]+$/i.test(String(code)))
    throw new Error(`yahoo_${viaEmail ? 'email' : 'sms'}_otp_failed: ${code}`);
  await humanFill(s.page, field, code);
  await submitStep(s.page);
  return true;
}

/** A password step: the identity's password, and its confirmation when asked. */
export async function maybeHandlePassword(page, password) {
  const field = await shown(page, ['input[name="password"]', 'input[type="password"]']);
  if (!field) return false;
  await humanFill(page, field, password);
  const confirm = await shown(page, ['input[name*="confirm" i]', 'input[id*="confirm" i]']);
  if (confirm) await humanFill(page, confirm, password);
  await submitStep(page);
  return true;
}

/** The control that opens password setup, when Yahoo offers one before it. */
export async function maybeOpenPasswordSetup(page) {
  const offered = await shown(page, ['a[href*="password"]']);
  if (!offered) return false;
  await humanClickLocator(page, offered);
  await pageSettled(page);
  return true;
}
