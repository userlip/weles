// Create a Snapchat account. The generated identity's name, birth date,
// username and password go into Snapchat's signup fields (found by their
// autocomplete and name structure), each step continued by the button the
// vision model finds. Snapchat then asks for an email or a phone: the email
// is the identity's own (its mailed code read from the inbox, waiting until it
// arrives), the phone one number rented in the field's country (its SMS code
// read from that order). The account counts once Snapchat leaves the signup
// for the account or the web app; it is then saved to Skarbiec. A refusal is
// thrown and sets the exit status from its error.
import { WSession } from '../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { humanFill } from '../../../dist/human/keyboard.js';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { phoneForField } from '../_shared/inputs/phone.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { autocompleteField, field } from '../_shared/page/offers.mjs';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';
import { fieldCodeLength, mailedCode } from '../_shared/inputs/mailed_code.mjs';

const SIGNUP = new URL('https://accounts.snapchat.com/accounts/signup');
const CONTINUE = 'the button that continues the signup to its next step';

async function continueSignup(s) {
  await clickDescribed(s.page, CONTINUE);
  await pageSettled(s.page);
}

/** The first visible field among `finders` (each answers a field or null); refused by `what` when none shows. */
async function firstField(s, what, finders) {
  for (const find of finders) {
    const found = await find();
    if (found) return found;
  }
  throw new Error(`SNAPCHAT_FIELD_MISSING: the signup at ${s.page.url()} shows no ${what} field`);
}

async function fillStep(s, what, finders, value) {
  await humanFill(s.page, await firstField(s, what, finders), value);
  await continueSignup(s);
}

/** The birth date: one date input (ISO date), else month, day and year selects. */
async function fillBirthDate(s, id) {
  const dateInput = s.page.locator('input[type="date"]').filter({ visible: true }).first();
  if (await dateInput.count()) {
    const [isoDate] = new Date(`${id.birthMonth} ${id.birthDay}, ${id.birthYear} UTC`).toISOString().split('T');
    await dateInput.fill(isoDate);
  } else {
    await s.page.locator('select[name="month"]').selectOption({ label: id.birthMonth });
    await s.page.locator('select[name="day"]').selectOption(id.birthDay);
    await s.page.locator('select[name="year"]').selectOption(id.birthYear);
  }
  await continueSignup(s);
}

async function verifyContact(s, id) {
  const email = await autocompleteField(s.page, 'email');
  const phone = await autocompleteField(s.page, 'tel');
  const codeField = () => firstField(s, 'verification code', [() => autocompleteField(s.page, 'one-time-code'), () => field(s.page, 'code')]);
  if (email) {
    await humanFill(s.page, email, id.email);
    await continueSignup(s);
    const codeInput = await codeField();
    const code = await mailedCode(id.email, 'snapchat', await fieldCodeLength(codeInput));
    await humanFill(s.page, codeInput, code);
    await continueSignup(s);
    return { email: id.email };
  }
  if (phone) {
    const number = await phoneForField(s, s.page, 'snapchat');
    await humanFill(s.page, phone, number);
    await continueSignup(s);
    const code = await s.pollSmsCode();
    if (!/^\d+$/.test(code)) throw new Error(`SNAPCHAT_SMS_CODE_UNREAD: the rented number ${number} received no code: ${code}`);
    await humanFill(s.page, await codeField(), code);
    await continueSignup(s);
    return { email: id.email, phone: number };
  }
  throw new Error(`SNAPCHAT_CONTACT_STEP_UNKNOWN: the signup at ${s.page.url()} asks for neither an email nor a phone`);
}

const s = await WSession.start({ label: 'snapchat_register', proxy: statedProxy('the Snapchat signup') });
try {
  const id = await s.generateIdentity('snapchat');
  console.log(`[sc] identity: ${id.username} / ${id.email}`);
  await s.goto(SIGNUP.href);
  await pageSettled(s.page);
  await humanFill(s.page, await firstField(s, 'first name', [() => autocompleteField(s.page, 'given-name'), () => field(s.page, 'firstName')]), id.firstName);
  const lastName = (await autocompleteField(s.page, 'family-name')) || (await field(s.page, 'lastName'));
  if (lastName) await humanFill(s.page, lastName, id.lastName);
  await continueSignup(s);
  await fillBirthDate(s, id);
  await fillStep(s, 'username', [() => autocompleteField(s.page, 'username'), () => field(s.page, 'username')], id.username);
  await fillStep(s, 'password', [() => autocompleteField(s.page, 'new-password'), () => field(s.page, 'password')], id.password);
  const contact = await verifyContact(s, id);
  await urlMatching(s.page, (url) => new URL(url).pathname !== SIGNUP.pathname);
  console.log(`[sc] ${await s.saveAccount('snapchat', { username: id.username, password: id.password, status: 'verified', ...contact })}`);
  console.log(`PASS: ${id.username}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
