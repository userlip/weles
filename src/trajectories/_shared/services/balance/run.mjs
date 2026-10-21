// One service's balance check: sign in (through the service's Google control
// and Google SSO, or the service's own sign-in), open the page that shows the
// balance when that is not where the sign-in lands, read the balance (an
// unreadable page is kept with the run), and persist it through the caller's
// record writer. Every failure throws with the service's label in its code.
import { WSession } from '../../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { pageSettled, popupOrNavigation, urlMatching } from '../../page/settled.mjs';
import { reviewUntilClosed } from '../../page/navigation/review.mjs';
import { googleSso } from '../google_sso.mjs';
import { readShownBalance, keepUnreadBalancePage } from '../google_sso/service_account.mjs';
import { submitLoginForm } from '../native_login/submit.mjs';

const GOOGLE_ACCOUNTS = /^https:\/\/accounts\.google\.com\//;

/**
 * Signing in through the service's own login form: the user and password
 * fields typed key by key, then the form submitted.
 * @param {object} form
 * @param {{email: string, password: string}} form.login the service login
 * @param {string} form.loginUrl  the service's login page
 * @param {string} form.userField the selector of its username or email field
 */
export function formSignIn(form) {
  return async (s) => {
    console.log(`[trajectory] Using service login: ${form.login.email}`);
    await s.goto(form.loginUrl);
    const userIn = s.page.locator(form.userField).filter({ visible: true }).first();
    await userIn.waitFor({ state: 'visible' });
    await userIn.click();
    await userIn.pressSequentially(form.login.email);
    const pwIn = s.page.locator('input[name="password"], input[type="password"]').filter({ visible: true }).first();
    await pwIn.waitFor({ state: 'visible' });
    await pwIn.click();
    await pwIn.pressSequentially(form.login.password);
    await submitLoginForm(s.page, pwIn);
  };
}

/**
 * Signing in through the service's Google control.
 * @param {object} google
 * @param {object} google.login         the Google identity that signs in
 * @param {string} google.loginUrl      the service's login page
 * @param {string} google.googleControl the selector of the service's Google sign-in control
 * @param {string} google.originHost    the host Google SSO returns to
 * @param {string} [google.openControl] the selector of a control that first opens the sign-in (a modal)
 * @param {string} [google.controlFrame] text of the address of the frame the Google control is drawn in
 * @param {boolean} [google.popup]      the control opens Google's sign-in in a popup
 * @param {RegExp | ((url: string) => boolean)} [google.signedInUrl] the address the service settles on once signed in
 */
export function googleSignIn(google) {
  return async (s, code) => {
    console.log(`[trajectory] Using Google SSO: ${google.login.email}`);
    await s.goto(google.loginUrl);
    await pageSettled(s.page);
    if (google.openControl) await humanClickLocator(s.page, s.page.locator(google.openControl).first());
    const root = google.controlFrame ? s.page.frames().find((frame) => frame.url().includes(google.controlFrame)) : s.page;
    if (!root) throw new Error(`${code}_GOOGLE_FRAME_ABSENT: no frame at ${google.controlFrame} on ${s.page.url()}`);
    const control = root.locator(google.googleControl).filter({ visible: true }).first();
    await control.waitFor({ state: 'visible' });
    if (!(await control.isEnabled())) throw new Error(`${code}_GOOGLE_CONTROL_DISABLED: ${s.page.url()}`);
    // A popup control opens Google in its own window, or navigates the page
    // itself when the browser keeps it in the tab; SSO runs where Google is.
    const popup = google.popup
      ? await popupOrNavigation(s.page, GOOGLE_ACCOUNTS, () => humanClickLocator(s.page, control))
      : null;
    if (popup) await pageSettled(popup);
    else if (!google.popup) await humanClickLocator(s.page, control);
    const options = popup ? { originHost: google.originHost, page: popup } : { originHost: google.originHost };
    if (!(await googleSso(s, google.login, options)))
      throw new Error(`${code}_SSO_INCOMPLETE: Google sign-in did not return to ${google.originHost}; observed ${s.page.url()}`);
    if (google.signedInUrl) await urlMatching(s.page, google.signedInUrl);
  };
}

/**
 * @param {object} run
 * @param {string} run.label        the run's label and its errors' code prefix
 * @param {(s: object, code: string) => Promise<void>} run.signIn signs the session in
 * @param {string} [run.balanceUrl] the page that shows the balance, when the sign-in lands elsewhere
 * @param {(url: URL) => boolean} [run.onBalancePage] whether the settled balance page is the signed-in one
 * @param {(s: object) => Promise<number | null>} [run.readBalance] the service's own balance reading,
 *   when the dashboard does not show it as a dollar balance; null when the page shows none
 * @param {(balance: number) => Promise<boolean>} run.persist writes the balance; false when no record took it
 * @param {object} [run.session]    further WSession.start options the service needs (an OS persona)
 */
export async function runBalanceCheck(run) {
  const code = run.label.toUpperCase();
  const s = await WSession.start({ ...run.session, label: run.label, browser: 'chromium' });
  try {
    await run.signIn(s, code);
    if (run.balanceUrl) {
      const response = await s.page.goto(run.balanceUrl, { waitUntil: 'domcontentloaded' });
      if (!response) throw new Error(`${code}_BALANCE_PAGE_UNANSWERED: ${run.balanceUrl}`);
      if (!response.ok()) throw new Error(`${code}_BALANCE_PAGE_HTTP_ERROR: HTTP ${response.status()} at ${response.url()}`);
      const unfinished = await response.finished();
      if (unfinished) throw new Error(`${code}_BALANCE_PAGE_FAILED: ${response.url()}`, { cause: unfinished });
    }
    await pageSettled(s.page);
    if (run.onBalancePage && !run.onBalancePage(new URL(s.page.url())))
      throw new Error(`${code}_NOT_SIGNED_IN: the balance page settled on ${s.page.url()}`);
    const balance = run.readBalance ? await run.readBalance(s) : await readShownBalance(s.page);
    if (balance === null) await keepUnreadBalancePage(s, run.label);
    console.log(`[trajectory] balance=${balance}`);
    if (!(await run.persist(balance)))
      throw new Error(`${code}_BALANCE_NOT_PERSISTED: no record took the balance of ${run.label}`);
    console.log(`PASS: balance=${balance} (persisted)`);
    return balance;
  } finally {
    // KEEP_OPEN=1 leaves the browser for a person to review until they close it.
    try {
      if (process.env.KEEP_OPEN === '1' && !s.page.isClosed()) await reviewUntilClosed(s);
    } finally {
      await s.close();
    }
  }
}

/** A balance check signed in through Google SSO: `run` carries googleSignIn's fields and runBalanceCheck's. */
export function runGoogleSsoBalance(run) {
  return runBalanceCheck({ ...run, signIn: googleSignIn(run) });
}
