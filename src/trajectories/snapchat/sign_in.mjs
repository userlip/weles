// Signing a Snapchat account in: its login (email, else username) and its
// password on Snapchat's account sign-in, each step submitted by its own form
// from the field just typed in, then the web app opened. The web app answers
// only a signed-in session; landing anywhere else is refused with where it
// went.
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';

const LOGIN_URL = new URL('https://accounts.snapchat.com/accounts/login');
export const WEB_APP = new URL('https://web.snapchat.com/');

async function typeInto(s, field, value) {
  await field.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, field);
  await humanType(s.page, value);
  await s.page.keyboard.press('Enter');
}

/** Signs `s` in to Snapchat as `login` and opens the web app. */
export async function signInToSnapchat(s, login, password) {
  await s.goto(LOGIN_URL.href);
  await pageSettled(s.page);
  const visible = (selector) => s.page.locator(selector).filter({ visible: true }).first();
  await typeInto(s, visible('input[autocomplete="username"], input[name="username"], input[type="email"]'), login);
  await typeInto(s, visible('input[autocomplete="current-password"], input[type="password"]'), password);
  await urlMatching(s.page, (url) => new URL(url).pathname !== LOGIN_URL.pathname);
  await s.goto(WEB_APP.href);
  await pageSettled(s.page);
  if (new URL(s.page.url()).hostname !== WEB_APP.hostname)
    throw new Error(`SNAPCHAT_SIGN_IN_FAILED: after signing in as ${login} the web app sent the session to ${s.page.url()}`);
}

/** runAction's relogin: the account signed in again on the action's own session. */
export async function reloginSnapchat(s, acct) {
  if (!acct.metadata.password)
    throw new Error(`SNAPCHAT_PASSWORD_UNAVAILABLE: account ${acct.username} stores no password to sign in again`);
  await signInToSnapchat(s, acct.metadata.email ? acct.metadata.email : acct.username, acct.metadata.password);
  return { ok: true };
}
