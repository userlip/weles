// Signing a generic browser task's session into the service whose token it
// acquires: Supabase through Google SSO, Figma through its own password form
// or Google SSO. The task states the account; a sign-in that does not reach
// the service's signed-in pages fails with what the page showed.
import {
  getGoogleSsoCreds,
  googleSso,
} from '../../_shared/services/google_sso.mjs';
import { pageSettled, popupOrNavigation, urlMatching } from '../../_shared/page/settled.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { onGoogleSignIn } from '../../_shared/profile/google_session.mjs';
import { humanFill } from '../../../../dist/human/keyboard.js';

const GOOGLE_CONTROL = 'the button or link to continue with Google';
const FIGMA_LOGIN = /figma\.com\/login(?:[/?#]|$)/i;
const FIGMA_HOST = /(^|\.)figma\.com$/i;
const FIGMA_SECURITY_SETTINGS = 'https://www.figma.com/settings?tab=security';
const SUPABASE_DASHBOARD = /supabase\.com\/dashboard/;
const SUPABASE_SIGN_IN = /sign-in/i;

/** Whether `url` is a Figma page other than its login. */
const onFigmaSignedIn = (url) => FIGMA_HOST.test(new URL(url).hostname) && !FIGMA_LOGIN.test(url);

/** The task's stated account email, normalized; refused when the task states none. */
function statedAccount(taskConstraints, service) {
  const email = taskConstraints.account_email;
  if (typeof email !== 'string' || !email.trim())
    throw new Error(`${service} token acquisition requires an exact account email`);
  return email.trim().toLowerCase();
}

/** The Google sign-in credentials of `email`; refused when Skarbiec holds none. */
async function googleCredentials(email) {
  const credentials = await getGoogleSsoCreds(email);
  if (!credentials) throw new Error(`Google SSO credentials are unavailable for ${email}`);
  return credentials;
}

/** Clicks the Google control and answers the Google sign-in surface: the popup it opened, or this page once it is on Google's sign-in host. */
async function clickToOAuthPage(page) {
  const popup = await popupOrNavigation(page, onGoogleSignIn, () => clickDescribed(page, GOOGLE_CONTROL));
  return popup ?? page;
}

/** Sign the session into Supabase through Google SSO when the task acquires a Supabase token. */
export async function ensureSupabaseSession(activeSession, taskConstraints) {
  if (taskConstraints.secret !== 'supabase.personal_access_token') return;
  const accountEmail = statedAccount(taskConstraints, 'Supabase');
  const page = activeSession.page;
  await pageSettled(page);
  if (!SUPABASE_SIGN_IN.test(page.url()) && !onGoogleSignIn(page.url())) return;
  const credentials = await googleCredentials(accountEmail);
  const authPage = onGoogleSignIn(page.url()) ? page : await clickToOAuthPage(page);
  if (!(await googleSso(activeSession, credentials, { page: authPage, originHost: 'supabase.com' })))
    throw new Error(`Google SSO failed for ${accountEmail}`);
  await urlMatching(page, SUPABASE_DASHBOARD);
}

/** Try Figma's own email + password form first; true when it established a session. */
async function figmaDirectLogin(page, credentials) {
  const emailInput = page.locator('input[type="email"], input[name="email"]').filter({ visible: true }).first();
  if (!(await emailInput.isVisible())) return false;
  await humanFill(page, emailInput, credentials.email);
  await emailInput.press('Enter');
  await pageSettled(page);
  const passwordInput = page.locator('input[type="password"], input[name="password"]').filter({ visible: true }).first();
  if (!(await passwordInput.isVisible())) return false;
  await humanFill(page, passwordInput, credentials.password);
  await page.keyboard.press('Enter');
  await pageSettled(page);
  if (FIGMA_LOGIN.test(page.url())) {
    console.log('[figma_sso] the password form did not establish a session; using Google SSO');
    return false;
  }
  console.log('[figma_sso] established the Figma session with the password form');
  return true;
}

// Google's OAuth popup closes itself once the account is chosen, taking the
// handoff with it; the popup is kept open so the redirect lands somewhere.
function keepOAuthPageOpen() {
  Object.defineProperty(window, 'close', { configurable: false, value: () => undefined, writable: false });
}

/** The page the task continues on after Google SSO: the original, or a live Figma page (a signed-in one first), or the blank page kept for recovery. */
function pageAfterSso(context, page, recoveryPage) {
  if (!page.isClosed()) return page;
  const figmaPages = context
    .pages()
    .filter((candidate) => !candidate.isClosed() && URL.canParse(candidate.url()) && FIGMA_HOST.test(new URL(candidate.url()).hostname));
  const [anyFigmaPage] = figmaPages;
  const signedIn = figmaPages.find((candidate) => !FIGMA_LOGIN.test(candidate.url()));
  return signedIn ?? anyFigmaPage ?? recoveryPage;
}

/** Sign the session into Figma when the task acquires a Figma token, by password or Google SSO. */
export async function ensureFigmaSession(activeSession, taskConstraints) {
  if (taskConstraints.secret !== 'figma.personal_access_token') return;
  const accountEmail = statedAccount(taskConstraints, 'Figma');
  const page = activeSession.page;
  const context = page.context();
  await pageSettled(page);
  const requiresSignIn =
    /\/login(?:[/?#]|$)/i.test(page.url()) ||
    onGoogleSignIn(page.url()) ||
    (await pageShows(page, `Does the page show ${GOOGLE_CONTROL}?`));
  if (!requiresSignIn) return;

  const credentials = await googleCredentials(accountEmail);
  await context.addInitScript(keepOAuthPageOpen);
  await page.evaluate(keepOAuthPageOpen);
  if (await figmaDirectLogin(page, credentials)) return;

  let recoveryPage = null;
  let authPage = page;
  if (!onGoogleSignIn(page.url())) {
    recoveryPage = await context.newPage();
    await recoveryPage.goto('about:blank');
    authPage = await clickToOAuthPage(page);
  }
  if (!(await googleSso(activeSession, credentials, { page: authPage, originHost: 'figma.com' })))
    throw new Error(`Figma Google SSO failed for ${accountEmail}`);
  console.log(
    `[figma_sso] pages after Google SSO=${JSON.stringify(
      context.pages().map((candidate) => ({ closed: candidate.isClosed(), url: candidate.url() })),
    )}`,
  );
  const targetPage = pageAfterSso(context, page, recoveryPage);
  if (!targetPage || targetPage.isClosed())
    throw new Error(`Figma closed every recoverable page after Google SSO for ${accountEmail}`);
  activeSession.page = targetPage;
  // The blank recovery page holds no Figma document to wait on; it is sent
  // to Figma's settings, which a signed-in session can open.
  if (targetPage === recoveryPage || FIGMA_LOGIN.test(targetPage.url())) {
    await targetPage.goto(FIGMA_SECURITY_SETTINGS);
    await pageSettled(targetPage);
  } else {
    await urlMatching(targetPage, onFigmaSignedIn);
  }
  if (FIGMA_LOGIN.test(targetPage.url()))
    throw new Error(`Figma did not establish a session for ${accountEmail}`);
}
