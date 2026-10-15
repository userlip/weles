// Pangram account registration for authenticated audits. The account is the
// session's generated identity (the domain rotator's mailbox, a generated
// password and name). After the signup form is sent, Pangram's own
// session-status answer says whether the browser is signed in; when it is
// not, the address is proven through Pangram's verification mail (the code
// its code field takes, or the pangram.com link it carries, read once the
// mail arrives), and the sign-in form is used when the page then asks for
// the password. The account is saved to Skarbiec once Pangram answers that
// the browser is signed in; anything else fails the run with its cause.
//
// Pangram is a direct-egress platform in Weles's network policy; a proxy is
// used only when PANGRAM_REGISTRATION_PROXY_URL names one.
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { WSession } from '../../../dist/session/wsession.js';
import { fieldCodeLength, mailedCode, mailedLink } from '../_shared/inputs/mailed_code.mjs';
import { clickDescribed, clickOffered } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { FIELDS, dismissCookies, fillEvery, fillField, signedIn, signInWithPassword, visible } from './register/page.mjs';

const SIGNUP_URL = 'https://www.pangram.com/signup';
const PANGRAM_HOST = 'pangram.com';
// The sender Pangram's verification mail comes from.
const PANGRAM_SENDER = 'pangram';

async function fillSignupForm(page, id) {
  await fillField(page, 'email', FIELDS.email, id.email);
  // The form may ask for the password twice; each password field takes it.
  await fillEvery(page, 'password', FIELDS.password, id.password);
  if (await visible(page, FIELDS.firstName).count()) await fillField(page, 'first name', FIELDS.firstName, id.firstName);
  if (await visible(page, FIELDS.lastName).count()) await fillField(page, 'last name', FIELDS.lastName, id.lastName);
  const termsAccepted = await clickOffered(page, 'the unchecked checkbox that accepts the terms of service or privacy policy');
  console.log(`[pangram_register] terms_checked=${termsAccepted}`);
}

/** Prove the address through Pangram's verification mail, then sign in when the page asks for the password. */
async function verifyThroughMail(page, id) {
  const codeField = visible(page, FIELDS.code).first();
  if (await codeField.count()) {
    const code = await mailedCode(id.email, PANGRAM_SENDER, await fieldCodeLength(codeField));
    await fillField(page, 'code', FIELDS.code, code);
    await page.keyboard.press('Enter');
  } else {
    await page.goto(await mailedLink(id.email, PANGRAM_SENDER, PANGRAM_HOST), { waitUntil: 'domcontentloaded' });
  }
  await pageSettled(page);
  if (!(await signedIn(page)) && (await visible(page, FIELDS.password).count()))
    await signInWithPassword(page, id.email, id.password);
}

const s = await WSession.start({
  label: 'pangram_register',
  browser: 'chromium',
  targetHost: 'www.pangram.com',
  proxy: process.env.PANGRAM_REGISTRATION_PROXY_URL,
  platform: 'pangram',
});
try {
  const id = s.identity;
  console.log(`[pangram_register] email=${id.email}`);
  await s.goto(SIGNUP_URL);
  await pageSettled(s.page);
  await dismissCookies(s.page);
  await clickOffered(s.page, 'the option to sign up with email and password');
  await fillSignupForm(s.page, id);
  await clickDescribed(s.page, 'the button that submits the sign-up form');
  await pageSettled(s.page);
  if (!(await signedIn(s.page))) await verifyThroughMail(s.page, id);
  if (!(await signedIn(s.page)))
    throw new Error(`PANGRAM_NOT_SIGNED_IN: Pangram answers that ${id.email} is not signed in after the signup, at ${s.page.url()}`);
  const saved = await s.saveAccount('pangram', { username: id.email, email: id.email, password: id.password, status: 'created' });
  console.log(`[pangram_register] saveAccount=${saved}`);
  console.log(`PASS: pangram account ready ${id.email}`);
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
