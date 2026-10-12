// Signing in to Unusual Whales, shared by every script in this directory.
//
// The form is waited for until its password field exists. The account field
// is the one visible text or e-mail field of the password field's own form,
// told apart by the form's structure, not by words in its placeholder. The
// form is submitted from the password field, and the submit is answered by
// the page leaving /login or by the form's own alert, whose text is the
// failure. Unusual Whales gates a risky sign-in behind a reCAPTCHA checkbox:
// when the submit leaves the page on /login with a captcha frame on it, the
// captcha is solved and the form submitted again. Nothing here gives up on a
// count: the page decides when it is ready, and the run's cancellation ends
// a page that never answers.

import {
  pageCondition,
  pageSettled,
  submitAnswered,
} from '../../_shared/page/settled.mjs';

/** Input types an account name is typed into. */
const ACCOUNT_TYPES = { email: true, text: true };
/** A captcha frame, by the vendor path that serves it. */
const CAPTCHA_FRAME = /\/recaptcha\//;

async function accountFields(page) {
  return page.evaluate((types) => {
    const password = document.querySelector('input[type="password"]');
    const scope = password.form
      ? Array.from(password.form.elements)
      : Array.from(document.querySelectorAll('input'));
    return scope
      .filter(
        (field) =>
          field instanceof HTMLInputElement &&
          field !== password &&
          field.offsetParent !== null &&
          Object.hasOwn(types, field.type),
      )
      .map((field) => ({
        name: field.name,
        id: field.id,
        type: field.type,
        ph: field.placeholder,
      }));
  }, ACCOUNT_TYPES);
}

function selector(field) {
  if (field.name) return `input[name="${field.name}"]`;
  if (field.id) return `input[id="${field.id}"]`;
  return `input[placeholder="${field.ph}"]`;
}

async function submitFromPassword(session) {
  await session.page.locator('input[type="password"]').first().press('Enter');
  await pageSettled(session.page);
}

const onLogin = (page) => new URL(page.url()).pathname.startsWith('/login');

export async function loginUnusualWhales(session, email, password) {
  const page = session.page;
  await session.goto('https://unusualwhales.com/login');
  await pageCondition(
    page,
    () => document.querySelector('input[type="password"]') !== null,
  );
  const fields = await accountFields(page);
  const [account, ...others] = fields;
  if (account === undefined || others.length)
    throw new Error(
      `UNUSUALWHALES_LOGIN_FORM: the password field's form needs exactly one visible account field; it has ${JSON.stringify(fields)}`,
    );
  await session.fillSelector(selector(account), email);
  await pageSettled(page);
  await session.fillSelector('input[type="password"]', password);
  await pageSettled(page);
  await submitFromPassword(session);
  if (
    onLogin(page) &&
    page.frames().some((frame) => CAPTCHA_FRAME.test(frame.url()))
  ) {
    console.error(
      `[unusualwhales] sign-in held by its captcha: ${await session.solveCaptcha()}`,
    );
    await submitFromPassword(session);
  }
  const alert = page
    .locator('[role="alert"]')
    .filter({ visible: true })
    .first();
  if ((await submitAnswered(page, '/login', alert)) === 'message') {
    throw new Error(
      `unusualwhales login refused: ${(await alert.innerText()).trim()}`,
    );
  }
}
