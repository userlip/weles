// Sign the active GitHub account in through github.com/login, through the
// shared login runner (../_shared/action/login.mjs): the account, its
// proxy, the kept session and the verdict are the runner's.
//
// Login is always the form: saved cookies may belong to another device.
// GitHub's own error banner on the form is the refusal, quoted. A
// device-verification page is answered with the code from the mail GitHub
// sends for this attempt, read from Skrzynka: the run of digits as long as
// the page's code field takes. GitHub's gate routes are a checkpoint. The
// login counts once GitHub has set a user_session cookie and left its login
// and gate pages.
import { humanFill, humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../dist/platforms/github/ban_signals.js';
import { runLogin } from '../_shared/action/login.mjs';
import { messagesTo } from '../../_shared/mail/skrzynka-inbox.mjs';
import { pageSettled, submitAnswered } from '../_shared/page/settled.mjs';

const LOGIN_URL = 'https://github.com/login';
// GitHub's sign-in routes, and the gates it puts in front of an account it
// will not sign in yet.
const SIGN_IN_ROUTES = ['/login', '/session'];
const DEVICE_ROUTE = '/sessions/verified-device';
const GATE_ROUTES = [DEVICE_ROUTE, '/sessions/two-factor', '/account_lockout', '/account_recovery'];
const routeOf = (url, routes) =>
  routes.find((route) => new URL(url).pathname.startsWith(route));
const onSignIn = (url) => Boolean(routeOf(url, SIGN_IN_ROUTES));

/**
 * Answer GitHub's device verification with the code from the mail it sent
 * for this attempt (one not in `seenBefore`). Refused when that mail has not
 * arrived or holds no code of the length the page's field takes.
 */
async function verifyDevice(s, login, seenBefore) {
  const field = s.page
    .locator('input[autocomplete="one-time-code"], input[name="otp"]')
    .filter({ visible: true })
    .first();
  await field.waitFor({ state: 'visible' });
  const length = Number(await field.getAttribute('maxlength'));
  if (!Number.isSafeInteger(length) || !length)
    throw new Error(`GITHUB_DEVICE_CODE_LENGTH_UNKNOWN: the verification field on ${s.page.url()} states no maxlength`);
  const code = new RegExp(`\\b\\d{${length}}\\b`);
  const arrived = (await messagesTo(login, 'github.com')).filter((m) => !seenBefore.has(m.id));
  const found = arrived.map((m) => m.body_text.match(code)?.shift()).find(Boolean);
  if (!found)
    throw new Error(
      `GITHUB_DEVICE_CODE_MISSING: none of the ${arrived.length} mails to ${login} that arrived since the attempt holds a ${length}-digit code; run the login again once it is in the inbox`,
    );
  await humanClickLocator(s.page, field);
  await humanType(s.page, found);
  await pageSettled(s.page);
}

await runLogin({
  platform: 'github',
  banDetector: detectGitHubBanSignals,
  signIn: async (s, { acct, login, password }) => {
    await s.ctx.clearCookies();
    await s.goto(LOGIN_URL);
    await pageSettled(s.page);
    const address = s.page.locator('input#login_field').first();
    const secret = s.page.locator('input#password').first();
    if (!(await address.count()) || !(await secret.count()))
      throw new Error(`GITHUB_LOGIN_FORM_MISSING: ${s.page.url()} shows no login form`);
    await humanFill(s.page, address, login);
    await humanFill(s.page, secret, password);
    const seenBefore = new Set((await messagesTo(login, 'github.com')).map((m) => m.id));
    const submit = secret
      .locator('xpath=ancestor::form[1]')
      .locator('input[type="submit"], button[type="submit"]')
      .first();
    if (!(await submit.count()))
      throw new Error(`GITHUB_LOGIN_SUBMIT_MISSING: ${s.page.url()} shows no sign-in control`);
    await humanClickLocator(s.page, submit);
    const banner = s.page.locator('.flash-error, [role="alert"]').filter({ hasText: /\S/ }).first();
    await submitAnswered(s.page, onSignIn, banner);
    if (onSignIn(s.page.url()))
      throw new Error(
        `GITHUB_LOGIN_REFUSED: ${(await banner.count()) ? (await banner.innerText()).trim() : `GitHub stayed on ${s.page.url()}`}`,
      );
    if (routeOf(s.page.url(), [DEVICE_ROUTE])) await verifyDevice(s, login, seenBefore);
    const gate = routeOf(s.page.url(), GATE_ROUTES);
    if (gate)
      throw Object.assign(new Error(`GITHUB_LOGIN_GATED: GitHub holds ${acct.username} at ${gate}`), {
        banSignal: { signal: 'checkpoint', healthy: false, details: { final_url: s.page.url() } },
      });
    const cookies = await s.ctx.cookies();
    if (!cookies.some((c) => c.name === 'user_session' && c.value))
      throw new Error(`GITHUB_SESSION_MISSING: GitHub set no user_session cookie; the session is at ${s.page.url()}`);
  },
});
