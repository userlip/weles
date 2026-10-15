// Instagram signup with a rented phone number. The signup form takes the
// whole international number (rented in PHONE_COUNTRY: the form has no
// country selector); a phone challenge after signup rents one number in the
// country its own selector is set to (_shared/inputs/phone.mjs). Each number
// costs money, so a step whose code never arrives fails the run instead of
// renting another. Instagram's post-signup flow is told apart by its URL path
// and the input the page asks for, never by the page's words.
import { WSession } from '../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { humanFill } from '../../../dist/human/keyboard.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { autoBindCharacter } from '../lib/character-bind.mjs';
import { pickInstagramProxy } from '../lib/instagram-proxy.mjs';
import { phoneForField } from '../_shared/inputs/phone.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { autocompleteField, field } from '../_shared/page/offers.mjs';
import { clickOffered, pressDescribed } from '../_shared/page/judged/seen.mjs';

const SIGNUP_URL = 'https://www.instagram.com/accounts/emailsignup/';
const NO_CODE = 'no code received';
const PATH = {
  passwordReset: '/accounts/password/reset',
  suspended: '/accounts/suspended',
  challenge: '/challenge',
  signup: '/accounts/emailsignup',
};
// Instagram renders its buttons as role="button" containers and a trusted
// mouse move crashes its page, so the vision model finds the control and an
// untrusted DOM click activates it.
const CONTINUE = 'the button that sends, confirms or continues this step';

const pathOf = (page) => new URL(page.url()).pathname;

async function codeField(page) {
  const named = await field(page, 'email_confirmation_code');
  return named ? named : autocompleteField(page, 'one-time-code');
}

// What the page asks for right now.
async function state(page) {
  const path = pathOf(page);
  if (path.startsWith(PATH.passwordReset)) return 'password_reset';
  if (await codeField(page)) return 'code';
  if (path.startsWith(PATH.suspended) || path.startsWith(PATH.challenge)) {
    if (await page.locator('input[type="file"]').first().isVisible()) return 'selfie';
    if (await page.locator('input[type="tel"]').first().isVisible()) return 'phone';
    return 'challenge';
  }
  if (path.startsWith(PATH.signup) && (await field(page, 'username'))) return 'form';
  return 'in';
}

/** Types the SMS code Instagram sent into its code field and continues; refused when none arrived. */
async function enterSmsCode(s, page, step) {
  const smsCode = await s.pollSmsCode();
  if (!smsCode || smsCode === NO_CODE) throw new Error(`instagram_sms_code_not_received: no SMS code arrived for the ${step}`);
  const code = await codeField(page);
  if (!code) throw new Error(`instagram_code_field_missing: Instagram took the number for the ${step} and shows no code field`);
  await code.fill(smsCode);
  await pageSettled(page);
  await pressDescribed(page, CONTINUE);
  await pageSettled(page);
}

/** A phone challenge: one number rented in the country its selector is set to, then its code. */
async function phoneChallenge(s, page) {
  const number = await phoneForField(s, page, 'instagram');
  await humanFill(page, page.locator('input[type="tel"]').first(), number);
  await pageSettled(page);
  await pressDescribed(page, CONTINUE);
  await pageSettled(page);
  await enterSmsCode(s, page, 'phone challenge');
}

async function signup(s) {
  const id = await s.generateIdentity('instagram');
  const name = `${id.firstName} ${id.lastName}`;
  const page = s.page;
  await s.goto(SIGNUP_URL);
  await pageSettled(page);
  if (await clickOffered(page, 'the button that allows only essential cookies')) await pageSettled(page);
  const number = await phoneForField(s, page, 'instagram');
  console.log(`[ig] identity: ${id.username} / phone=${number}`);
  await s.fill('email', number);
  await s.fill('password', id.password);
  // Date of birth: ARIA comboboxes with a virtualized listbox; s.select walks
  // it by aria-selected.
  await s.select('Select day', id.birthDay);
  await s.select('Select month', id.birthMonth);
  await s.select('Select year', id.birthYear);
  await s.fill('Full name', name);
  await s.fill('username', id.username);
  await pageSettled(page);
  await page.screenshot({ path: `${runRecordingsDir('instagram_register')}/ig_before_submit.png` });
  // The submit is a role="button" container, not a <button>.
  await s.click('Submit');
  await pageSettled(page);
  await page.screenshot({ path: `${runRecordingsDir('instagram_register')}/ig_after_submit.png` });

  // The settled page has left the form, or the form's own alert says why not.
  let current = await state(page);
  if (current === 'form') {
    const alert = page.locator('[role="alert"], #ssfErrorAlert').filter({ visible: true }).first();
    throw new Error(
      (await alert.count())
        ? `signup_form_refused: ${(await alert.innerText()).trim()}`
        : `signup_form_unanswered: the settled page is still the signup form at ${page.url()}`,
    );
  }
  console.log(`[ig] after submit: path=${pathOf(page)} state=${current}`);

  // However many onboarding steps Instagram shows are walked; a page offering
  // none of the known controls is the failure, named by its path and state.
  for (current = await state(page); current !== 'in'; current = await state(page)) {
    console.log(`[ig] onboarding: path=${pathOf(page)} state=${current}`);
    if (current === 'password_reset') throw new Error('password_reset_redirect');
    if (current === 'selfie') throw new Error('selfie_required');
    if (current === 'code') await enterSmsCode(s, page, 'signup number');
    else if (current === 'phone') await phoneChallenge(s, page);
    else if (current === 'challenge') {
      // A challenge with neither a phone nor a selfie field is continued once;
      // one that then asks for text beside an image is an image code this run
      // does not solve.
      await pressDescribed(page, CONTINUE);
      await pageSettled(page);
      if ((await state(page)) === 'challenge' && (await page.locator('main input[type="text"], form input[type="text"]').first().isVisible()))
        throw new Error('instagram_image_captcha: Instagram asked for an image code after signup; the run stops here');
    } else if (!(await pressDescribed(page, 'the button that skips this onboarding step or continues past it')))
      throw new Error(`instagram_onboarding_unrecognised: path=${pathOf(page)} state=${current}`);
    else await pageSettled(page);
  }
  if (pathOf(page).startsWith(PATH.suspended)) throw new Error('account_suspended');
  // Success is the session cookie Instagram sets on sign-in, not what the
  // page says (csrftoken is set for anonymous visitors too).
  const cookies = await s.ctx.cookies();
  if (!cookies.some((c) => c.domain.includes('instagram.com') && c.name === 'sessionid'))
    throw new Error(`no_auth_cookies: Instagram set ${cookies.map((c) => c.name).join(', ')} but no sessionid`);
  console.log(`[ig] ${await s.saveAccount('instagram', { username: id.username, email: id.email, password: id.password, name, phone: number })}`);
  console.log(`[bind] ${JSON.stringify(await autoBindCharacter(id.username, 'instagram'))}`);
  return id.username;
}

const s = await WSession.start({ label: 'instagram_register', proxy: pickInstagramProxy() });
try {
  console.log(`PASS: ${await signup(s)}`);
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
