// Pangram's signup and sign-in pages as the register trajectory drives them,
// and Pangram's own answer on whether the browser is signed in. Every step
// waits on the page, never on a pause; a step the page does not offer fails
// naming the field it looked for.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { clickOffered } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

const SESSION_STATUS = 'https://web.pangram.com/api/session-status/';

/** The form fields the pages carry, each as the selectors Pangram's markup is known by. */
export const FIELDS = {
  email:
    'input[type="email"], input[name*="email" i], input[placeholder*="email" i]',
  password: 'input[type="password"]',
  firstName: 'input[name*="first" i], input[placeholder*="first" i]',
  lastName: 'input[name*="last" i], input[placeholder*="last" i]',
  code: 'input[autocomplete="one-time-code"], input[name*="code" i]',
};

export async function dismissCookies(page) {
  if (await clickOffered(page, 'the button that accepts all cookies'))
    await pageSettled(page);
}

/** The visible fields `selector` matches. */
export function visible(page, selector) {
  return page.locator(selector).filter({ visible: true });
}

/** Type `value` into the first visible field `selector` matches; refused naming the field when the page shows none. */
export async function fillField(page, name, selector, value) {
  const field = visible(page, selector).first();
  if (!(await field.count()))
    throw new Error(
      `PANGRAM_FIELD_MISSING: ${page.url()} shows no ${name} field`,
    );
  await humanClickLocator(page, field);
  await humanFill(page, field, value);
}

/** Type `value` into every visible field `selector` matches (a password and its confirmation); refused naming the field when the page shows none. */
export async function fillEvery(page, name, selector, value) {
  const fields = await visible(page, selector).all();
  if (!fields.length)
    throw new Error(
      `PANGRAM_FIELD_MISSING: ${page.url()} shows no ${name} field`,
    );
  for (const field of fields) {
    await humanClickLocator(page, field);
    await humanFill(page, field, value);
  }
}

/** Pangram's own answer on whether this browser is signed in, read from inside the page. */
export async function signedIn(page) {
  const answer = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { ok: res.ok, status: res.status, body: await res.text() };
  }, SESSION_STATUS); // allow-raw-playwright: authenticated same-origin status probe
  if (!answer.ok)
    throw new Error(
      `PANGRAM_SESSION_UNREAD: ${SESSION_STATUS} answered ${answer.status}: ${answer.body}`,
    );
  let status;
  try {
    status = JSON.parse(answer.body);
  } catch (error) {
    throw new Error(
      `PANGRAM_SESSION_UNREAD: ${SESSION_STATUS} answered a body that is not JSON: ${answer.body}`,
      { cause: error },
    );
  }
  if (typeof status.isAuthenticated !== 'boolean')
    throw new Error(
      `PANGRAM_SESSION_UNREAD: ${SESSION_STATUS} states no isAuthenticated: ${answer.body}`,
    );
  return status.isAuthenticated;
}

/** Sign in with the email and password on a page that shows the sign-in form; the form submits from its password field. */
export async function signInWithPassword(page, email, password) {
  await fillField(page, 'email', FIELDS.email, email);
  await fillField(page, 'password', FIELDS.password, password);
  await page.keyboard.press('Enter');
  await pageSettled(page);
}
