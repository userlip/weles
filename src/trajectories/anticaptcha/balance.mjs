// AntiCaptcha balance check via real browser login, signed in through the
// shared Google SSO identity (../_shared/services/balance/run.mjs).
import { getGoogleSsoCreds, patchServiceBalance } from '../_shared/services/google_sso.mjs';
import { runGoogleSsoBalance } from '../_shared/services/balance/run.mjs';

await runGoogleSsoBalance({
  label: 'anticaptcha_balance',
  login: await getGoogleSsoCreds(),
  loginUrl: 'https://anti-captcha.com/clients/',
  googleControl: 'a:has-text("Continue with Google")',
  originHost: 'anti-captcha.com',
  persist: (balance) => patchServiceBalance('AntiCaptcha', balance),
});
