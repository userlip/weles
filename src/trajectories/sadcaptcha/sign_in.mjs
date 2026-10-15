// SadCaptcha's sign-in: its own username and password form (it offers no
// Google SSO), with the login sadcaptcha/register.mjs stores.
import { getServiceLogin } from '../../../dist/utils/credentials.js';
import { formSignIn } from '../_shared/services/balance/run.mjs';

export const SADCAPTCHA_DASHBOARD = 'https://www.sadcaptcha.com/dashboard';

export async function sadcaptchaSignIn() {
  const login = await getServiceLogin('SadCaptcha');
  if (!login)
    throw new Error(
      'SADCAPTCHA_LOGIN_ABSENT: no SadCaptcha login is stored; SadCaptcha signs in only with its own form, so sadcaptcha/register.mjs must store an account first',
    );
  return formSignIn({
    login,
    loginUrl: 'https://www.sadcaptcha.com/login',
    userField: 'input[name="username"], input[type="email"]',
  });
}
