// Product Hunt sign-up through X (Twitter) OAuth, walked to the main feed.
// Each step is told apart by the page's structure (its host and route, the
// fields it holds, the reCAPTCHA frame) or by the vision model reading what
// it shows; a control the step needs and does not offer fails the sign-up by
// name.
import { handleOAuthConsent } from '../../../../dist/platforms/_shared/cross_platform_oauth.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { autocompleteField } from '../../_shared/page/offers.mjs';
import { clickOffered, fillOffered } from '../../_shared/page/judged/seen.mjs';

const onX = (url) => {
  const host = new URL(url).hostname;
  return host.endsWith('x.com') || host.endsWith('twitter.com');
};

/** Sign in to X when the OAuth hand-off lands on its login flow. */
async function signInToX(page, twUsername, twPassword, twEmail) {
  const username = await autocompleteField(page, 'username');
  if (!username) return;
  console.log('[ph] re-authenticating with twitter credentials');
  await humanFill(page, username, twUsername);
  if (!(await clickOffered(page, 'the button that continues to the password step')))
    throw new Error(`PRODUCTHUNT_X_LOGIN_STUCK: X's login at ${page.url()} offers no control past the username`);
  await pageSettled(page);
  // X asks for the account's email or phone when it finds the login unusual.
  const confirm = page.locator('input[data-testid="ocfEnterTextTextInput"]').first();
  if (await confirm.isVisible()) {
    if (!twEmail)
      throw new Error('PRODUCTHUNT_X_LOGIN_EMAIL_REQUIRED: X asks to confirm the account email and none was given');
    await humanFill(page, confirm, twEmail);
    await humanClickLocator(page, page.locator('[data-testid="ocfEnterTextNextButton"]').first());
    await pageSettled(page);
  }
  await humanFill(page, page.locator('input[name="password"]').first(), twPassword);
  await humanClickLocator(page, page.locator('[data-testid="LoginForm_Login_Button"]').first());
  await pageSettled(page);
}

/** Product Hunt's reCAPTCHA gate, solved through the session's solver. */
async function passCaptchaGate(s) {
  const solved = await s.solveCaptcha();
  if (solved !== 'captcha solved')
    throw new Error(`PRODUCTHUNT_CAPTCHA_UNSOLVED: ${solved} at ${s.page.url()}`);
  const submit = s.page.locator('button[type="submit"]').first();
  if (!(await submit.isEnabled()))
    throw new Error(`PRODUCTHUNT_CAPTCHA_SUBMIT_DISABLED: the verification submit stayed disabled after the solve at ${s.page.url()}`);
  await humanClickLocator(s.page, submit);
  await pageSettled(s.page);
}

export async function completeProductHuntOnboarding(
  s,
  url,
  twAccount,
  twUsername,
  twPassword,
  twEmail,
) {
  const page = s.page;
  await s.goto(url);
  await pageSettled(page);
  if (await clickOffered(page, 'the button that accepts the cookie banner'))
    await pageSettled(page);
  if (page.isClosed()) throw new Error('page_crashed_on_cookie_dismiss');

  if (!(await clickOffered(page, 'the button that opens sign up (Sign up or Get started)')))
    throw new Error(`PRODUCTHUNT_SIGNUP_ABSENT: ${page.url()} offers no sign-up control`);
  await pageSettled(page);
  if (!(await clickOffered(page, 'the button that signs up or continues with X (Twitter), not another provider')))
    throw new Error(`PRODUCTHUNT_X_SIGNUP_ABSENT: the sign-up at ${page.url()} offers no X (Twitter) button`);
  await pageSettled(page);

  if (onX(page.url())) await signInToX(page, twUsername, twPassword, twEmail);
  await handleOAuthConsent(s);

  // The onboarding (name, email, interests, notifications): however many
  // steps it shows are walked until the main feed. A step that offers no
  // control forward, or that a press leaves unchanged, is the failure.
  let previous = null;
  for (;;) {
    if (page.isClosed()) throw new Error('page_crashed_during_onboarding');
    const current = new URL(page.url());
    console.log(`[ph] onboarding: url=${current.href}`);
    if (onX(current.href) && current.pathname.includes('/login'))
      throw new Error(`twitter_login_required: ${twUsername}`);
    const recaptcha = page.locator('iframe[src*="/recaptcha/api2/anchor"]').first();
    if (current.pathname.includes('/captcha_verification') || (await recaptcha.isVisible())) {
      await passCaptchaGate(s);
      continue;
    }
    if (
      current.hostname.endsWith('producthunt.com') &&
      (current.pathname === '/' || current.pathname.startsWith('/home') || current.pathname.startsWith('/feed'))
    )
      break;
    const shown = `${current.href}\n${await page.locator('body').innerText()}`;
    if (shown === previous)
      throw new Error(`producthunt_onboarding_unrecognised: the step at ${current.href} did not move on`);
    previous = shown;
    const filledName = await fillOffered(page, 'an empty field for your name or display name', twAccount.username);
    if (!filledName && twEmail) await fillOffered(page, 'an empty field for your email address', twEmail);
    if (!(await clickOffered(page, 'the button that continues, skips or finishes this onboarding step (Continue, Next, Skip, Not now, Done)')))
      throw new Error(`producthunt_onboarding_unrecognised: the step at ${current.href} offers no control forward`);
    await pageSettled(page);
  }
}
