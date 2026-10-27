// 2Captcha's sign-in: its own email and password form (its Google SSO is
// gated behind a proprietary widget solvers do not solve), with the login
// twocaptcha/register.mjs stores. The form asks reCAPTCHA v3 for a
// server-bound token itself; an unconfirmed account is confirmed with the
// code 2Captcha mailed, and a first login chooses the customer role.
import { getServiceLogin } from '../../../dist/utils/credentials.js';
import { pageCondition, pageSettled } from '../_shared/page/settled.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { humanType } from '../../../dist/human/keyboard.js';
import { mailedCode } from '../_shared/inputs/mailed_code.mjs';

export const TWOCAPTCHA_HOST = '2captcha.com';
// 2Captcha's own reCAPTCHA v3 site key, as its login page declares it.
const RECAPTCHA_SITE_KEY = '6Lfo9qojAAAAAPqqMn9QlAY2RBSVuEW63vDJ442M';

export async function twocaptchaSignIn() {
  const login = await getServiceLogin('2Captcha');
  if (!login)
    throw new Error(
      'TWOCAPTCHA_LOGIN_ABSENT: no 2Captcha login is stored; twocaptcha/register.mjs registers one',
    );
  return async (s) => {
    console.log(`[trajectory] Using 2Captcha login: ${login.email}`);
    await s.goto(`https://${TWOCAPTCHA_HOST}/auth/login`);
    await pageSettled(s.page);
    await s.page.locator('input[name="email"]').fill(login.email);
    await s.page.locator('input[name="password"]').fill(login.password);
    // Once grecaptcha has loaded, execute() obtains a server-bound token (a
    // token solved elsewhere is refused); the response field filling in is
    // what ends the wait.
    await pageCondition(
      s.page,
      () => typeof window.grecaptcha?.execute === 'function',
    );
    await s.page.evaluate(
      (key) => window.grecaptcha.execute(key, { action: 'login' }),
      RECAPTCHA_SITE_KEY,
    );
    await pageCondition(s.page, () =>
      Boolean(
        document.querySelector('textarea[name="g-recaptcha-response"]')?.value,
      ),
    );
    // The form's own POST answering ends the login attempt; the page then
    // settles wherever that answer sent it.
    const answered = s.page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' &&
        new URL(r.url()).hostname.endsWith(TWOCAPTCHA_HOST),
    );
    await s.page.locator('button:has-text("Continue")').click();
    await answered;
    await pageSettled(s.page);
    const path = () => new URL(s.page.url()).pathname;
    if (path().startsWith('/auth/login'))
      throw new Error(
        `TWOCAPTCHA_LOGIN_REFUSED: 2Captcha kept the login form after the submit (${s.page.url()})`,
      );
    if (path().startsWith('/auth/confirm-email')) {
      // The code goes into split one-digit inputs (otp-1, otp-2, ...) that
      // advance focus as each digit arrives, and the form submits itself
      // after the last one; there are as many as the code has digits.
      const digits = s.page.locator('input[name^="otp-"]');
      const code = await mailedCode(
        login.email,
        TWOCAPTCHA_HOST,
        await digits.count(),
      );
      await digits.first().click();
      await humanType(s.page, code);
      await pageSettled(s.page);
    }
    if (path().startsWith('/select-role')) {
      await clickDescribed(
        s.page,
        'the Next button of the customer role, not the worker role',
      );
      await pageSettled(s.page);
    }
  };
}
