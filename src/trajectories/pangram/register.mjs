// Pangram registration/login bootstrap for authenticated audits.
// DIAG=1 only dumps visible controls; normal mode creates and persists an account.

import { WSession } from '../../../dist/session/wsession.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { humanFill, humanType } from '../../../dist/human/keyboard.js';
import { generatePersona } from '../../../dist/browser/persona.js';
import { generateEmail, registrationPassword } from './register/identity.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import {
  countryHintFromProxy,
  selectRegistrationProxy,
} from './register/proxy.mjs';
import {
  inboxConfigured,
  inboxIdsFor,
  readPangramMail,
} from './register/inbox.mjs';
import {
  dismissCookies,
  dumpControls,
  fillFirst,
  isAuthenticatedStatus,
  loginWithPassword,
  sessionStatus,
} from './register/page.mjs';
import { clickDescribed, clickOffered } from '../_shared/page/judged/seen.mjs';

const SIGNUP_URL =
  process.env.PANGRAM_SIGNUP_URL || 'https://www.pangram.com/signup';
const EMAIL = generateEmail();
// The name the account is registered under is the caller's.
const FIRST_NAME = statedText(
  ['PANGRAM_FIRST_NAME'],
  'the first name the Pangram account is registered under',
);
const LAST_NAME = statedText(
  ['PANGRAM_LAST_NAME'],
  'the last name the Pangram account is registered under',
);
const PASSWORD = registrationPassword();

const regProxy = selectRegistrationProxy();
const persona = generatePersona({
  country: countryHintFromProxy(regProxy?.proxyUrl),
  browser: 'chromium',
});
console.log(
  `[pangram_register] email=${EMAIL} proxy=${regProxy?.proxyUrl ? 'yes' : 'direct'} domain=${EMAIL.split('@')[1]} persona_os=${persona?.userAgentOs || 'default'}`,
);
const s = await WSession.start({
  label: 'pangram_register',
  browser: 'chromium',
  targetHost: 'www.pangram.com',
  proxy: regProxy?.proxyUrl,
  persona,
});
if (!inboxConfigured())
  throw new Error(
    'pangram_register: no receiving inbox is configured for the verification mail',
  );
// What the inbox holds for this address before signup; the verification
// mail is the message that is not among these.
const seenBefore = await inboxIdsFor(EMAIL);

/** Fill the signup form: email, password (and its confirmation), names, and the terms box. */
async function fillSignupForm(page) {
  const emailOk = await fillFirst(
    page,
    [
      page.locator('input[type="email"]'),
      page.locator('input[name*="email" i]'),
      page.locator('input[placeholder*="email" i]'),
    ],
    EMAIL,
  );
  if (!emailOk) throw new Error('email_field_not_found');

  const passwordOk = await fillFirst(
    page,
    [
      page.locator('input[type="password"]').nth(0),
      page.locator('input[name*="password" i]'),
      page.locator('input[placeholder*="password" i]'),
    ],
    PASSWORD,
  );
  if (!passwordOk) throw new Error('password_field_not_found');

  const passwordFields = page.locator('input[type="password"]');
  if ((await passwordFields.count()) > 1) {
    const confirm = passwordFields.nth(1);
    if (await confirm.isVisible().catch(() => false)) {
      await humanClickLocator(page, confirm);
      await humanFill(page, confirm, '');
      await humanType(page, PASSWORD);
    }
  }
  await fillFirst(
    page,
    [
      page.locator('input[placeholder*="confirm" i]'),
      page.locator('input[name*="confirm" i]'),
    ],
    PASSWORD,
  );

  await fillFirst(
    page,
    [
      page.locator('input[name*="first" i]'),
      page.locator('input[placeholder*="first" i]'),
    ],
    FIRST_NAME,
  );
  await fillFirst(
    page,
    [
      page.locator('input[name*="last" i]'),
      page.locator('input[placeholder*="last" i]'),
    ],
    LAST_NAME,
  );

  const termsAccepted = await clickOffered(
    page,
    'the unchecked checkbox that accepts the terms of service or privacy policy',
  );
  console.log(`[pangram_register] terms_checked=${termsAccepted}`);
  await humanIdlePause('short');
}

/** Prove the address through the verification mail, then sign in if the page asks. */
async function verifyThroughMail(page) {
  const mail = await readPangramMail(EMAIL, seenBefore);
  if (!mail)
    throw new Error(
      `pangram_register: Pangram's verification mail for ${EMAIL} has not arrived yet; read the inbox again once it is there`,
    );
  console.log(
    `[pangram_register] mail=${JSON.stringify({ subject: mail.subject, hasCode: Boolean(mail.code), hasLink: Boolean(mail.pangramLink) })}`,
  );
  if (mail?.code) {
    const codeInput = page
      .locator(
        'input[autocomplete="one-time-code"], input[name*="code" i], input[maxlength="6"], input[maxlength="5"]',
      )
      .first();
    if (
      (await codeInput.count()) > 0 &&
      (await codeInput.isVisible().catch(() => false))
    ) {
      await humanClickLocator(page, codeInput);
      await humanType(page, mail.code);
      await codeInput.press('Enter');
      await humanIdlePause('long');
    }
  }
  if (mail?.pangramLink) {
    await s.goto(mail.pangramLink);
    await humanIdlePause('long');
  }
  let status = await sessionStatus(page);
  if (!isAuthenticatedStatus(status)) {
    // A page that asks for the password is Pangram's sign-in form.
    const signInForm = page.locator('input[type="password"]').first();
    if (await signInForm.isVisible()) {
      const loggedIn = await loginWithPassword(page, EMAIL, PASSWORD);
      console.log(`[pangram_register] post_verify_login=${loggedIn}`);
      await humanIdlePause('long');
      status = await sessionStatus(page);
    }
  }
  return status;
}

try {
  await s.goto(SIGNUP_URL);
  await humanIdlePause('long');
  await dismissCookies(s.page);

  if (process.env.DIAG === '1') {
    console.log(JSON.stringify(await dumpControls(s.page), null, 2));
    process.exit(0);
  }

  console.log(`[pangram_register] email=${EMAIL}`);
  await clickOffered(s.page, 'the option to sign up with email and password');
  await fillSignupForm(s.page);

  await clickDescribed(s.page, 'the button that submits the sign-up form');
  await humanIdlePause('long');

  let status = await sessionStatus(s.page);
  if (!isAuthenticatedStatus(status)) status = await verifyThroughMail(s.page);

  console.log(
    `[pangram_register] session_status=${status.status} body=${status.body}`,
  );
  if (!isAuthenticatedStatus(status)) {
    throw new Error('pangram_not_authenticated_after_signup');
  }

  const result = await s.saveAccount('pangram', {
    username: EMAIL,
    email: EMAIL,
    password: PASSWORD,
    status: 'created',
  });
  console.log(`[pangram_register] saveAccount=${result}`);
  console.log(`PASS: pangram account ready ${EMAIL}`);
} catch (e) {
  console.log(`FAIL: ${String(e?.message || e)}`);
  process.exitCode = 1;
} finally {
  await s.close();
}
