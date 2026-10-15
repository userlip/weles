// The Microsoft account password operations: proving a password with a fresh
// sign-in, changing it on account.live.com (through the recovery route when
// the current password is not known), and putting the previous one back.
// The sign-in walk is the converged-surface walk the Entra lifecycle uses;
// every step waits on the page, never on a pause.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickOffered, pageShows } from '../../_shared/page/judged/seen.mjs';
import { choosePasswordSignIn, visible } from '../entra_password_lifecycle/sign_in/surfaces.mjs';
import { LOGIN_HOSTS, LOGIN_URL, PASSWORD_CHANGE_URL } from './constants.mjs';
import {
  completeEmailIdentityChallenge,
  configuredUrl,
  fill,
  hasIdentityChallenge,
  leavePasskeyPrompt,
  showOtherWays,
} from './sign_in_page.mjs';

const EMAIL_INPUT = 'input[name="loginfmt"], input#i0116, input[type="email"]';
const PASSWORD_INPUT = 'input[name="passwd"], input#i0118, input[type="password"]';
const SUBMIT = 'input[type="submit"]#idSIButton9, button[type="submit"]';
const NEW_PASSWORD = 'input#iPassword, input[name="Password"][aria-label*="New password" i]';
const RETYPE_PASSWORD = 'input#iRetypePassword, input[name="RetypePassword"]';
const ACCOUNT_HOST = 'account.live.com';
const SECURITY_PAGE = { host: 'account.microsoft.com', path: '/security' };

async function submit(page) {
  await humanClickLocator(page, page.locator(SUBMIT).first());
  await pageSettled(page);
}

/** Whether `url` is still Microsoft's login page. */
function onLoginPage(url) {
  const { hostname, pathname } = new URL(url);
  return LOGIN_HOSTS.includes(hostname) && pathname.startsWith('/login');
}

/** Sign in from a clean context with the given password; true when Microsoft accepted it. */
export async function verifyPassword(session, email, password) {
  const page = session.page;
  await session.ctx.clearCookies();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  await fill(page, page.locator(EMAIL_INPUT).first(), email);
  await submit(page);
  await choosePasswordSignIn(page);
  const passwordInput = page.locator(PASSWORD_INPUT).first();
  if (!(await visible(passwordInput))) return false;
  await fill(page, passwordInput, password);
  await submit(page);
  // A refused password leaves Microsoft's password field on screen.
  if (await visible(page.locator('input[name="passwd"], input#i0118'))) return false;
  if (await hasIdentityChallenge(page)) return true;
  return !onLoginPage(page.url()) || (await pageShows(page, 'Does the page ask whether to stay signed in?'));
}

/**
 * The recovery route taken when the current password is not known: enter the
 * email, follow Microsoft's reset link on the account origin, leave any
 * passkey prompt, and confirm the sign-in name.
 */
async function openRecovery(page, email) {
  await pageSettled(page);
  const emailInput = page.locator(EMAIL_INPUT).first();
  if (await visible(emailInput)) {
    await fill(page, emailInput, email);
    await submit(page);
  }
  const resetUrl = await configuredUrl(page, ['urlResetPassword']);
  if (!resetUrl) {
    if (await clickOffered(page, 'the link for a forgotten password')) await pageSettled(page);
    return;
  }
  const target = new URL(resetUrl, page.url());
  if (target.hostname !== ACCOUNT_HOST) throw new Error(`Microsoft password reset URL ${target.origin} escaped the account origin`);
  await page.goto(target.href, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  await leavePasskeyPrompt(page);
  const resumeUrl = await configuredUrl(page, ['urlCancel', 'urlResume']);
  if (
    resumeUrl &&
    (await pageShows(page, 'Does the page say the recovery cannot continue now (a security waiting period) and offer to try again?'))
  ) {
    const resumeTarget = new URL(resumeUrl, page.url());
    if (!LOGIN_HOSTS.includes(resumeTarget.hostname))
      throw new Error(`Microsoft recovery resume URL ${resumeTarget.origin} escaped the login origin`);
    await page.goto(resumeTarget.href, { waitUntil: 'domcontentloaded' });
    await pageSettled(page);
  }
  await leavePasskeyPrompt(page);
  await showOtherWays(page);
  const recoveryEmail = page.locator('input#iSigninName, input[name="iSigninName"], input[type="email"]').first();
  if (await visible(recoveryEmail)) {
    await fill(page, recoveryEmail, email);
    await recoveryEmail.press('Enter');
    await pageSettled(page);
  }
}

/** The new-password form's two fields on `page`, once both show; null when they do not. */
async function dedicatedForm(page) {
  await pageSettled(page);
  const next = page.locator(NEW_PASSWORD).first();
  const retype = page.locator(RETYPE_PASSWORD).first();
  return (await visible(next)) && (await visible(retype)) ? { next, retype } : null;
}

/**
 * Change the password on account.live.com. Returns 'changed', 'rejected',
 * 'unavailable' (no password form reached) or 'ambiguous'.
 */
export async function changePassword(session, email, currentPassword, nextPassword) {
  let page = session.page;
  const recovering = process.env.MICROSOFT_ALLOW_UNKNOWN_CURRENT_PASSWORD_RECOVERY === '1';
  if (recovering) {
    // The recovery route has to take the code path, not a passkey Microsoft
    // would offer the browser first.
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: undefined });
    });
  }
  await page.goto(PASSWORD_CHANGE_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  await choosePasswordSignIn(page);
  if (recovering) await openRecovery(page, email);

  let form = await dedicatedForm(page);
  if (!form) {
    const challengePage = await completeEmailIdentityChallenge(page, email);
    if (challengePage) page = challengePage;
    form = await dedicatedForm(page);
  }
  if (form) {
    await fill(page, form.next, nextPassword);
    await fill(page, form.retype, nextPassword);
    await humanClickLocator(page, page.locator('input#UpdatePasswordAction, button[type="submit"], input[type="submit"]').first());
  } else {
    // The older form: the current password (when it asks for one), the new
    // one and its confirmation, as its last password fields.
    const passwordInputs = await page.locator('input[type="password"]').all();
    const [confirm, next, current] = passwordInputs.reverse();
    if (!next) return 'unavailable';
    if (current) await fill(page, current, currentPassword);
    await fill(page, next, nextPassword);
    await fill(page, confirm, nextPassword);
    await humanClickLocator(page, page.locator('button[type="submit"], input[type="submit"]').first());
  }
  await pageSettled(page);
  if (
    (await visible(page.locator('input[aria-invalid="true"]'))) ||
    (await pageShows(page, 'Does the page say the password could not be changed?'))
  )
    return 'rejected';
  const { hostname, pathname } = new URL(page.url());
  const onSecurityPage = hostname === SECURITY_PAGE.host && pathname.startsWith(SECURITY_PAGE.path);
  return onSecurityPage ||
    !(await visible(page.locator('input#iPassword, input[type="password"]'))) ||
    (await pageShows(page, 'Does the page confirm the password was changed?'))
    ? 'changed'
    : 'ambiguous';
}

/** Put the previous password back and prove it signs in. */
export async function rollbackPassword(session, email, currentPassword, previousPassword) {
  await changePassword(session, email, currentPassword, previousPassword);
  return verifyPassword(session, email, previousPassword);
}
