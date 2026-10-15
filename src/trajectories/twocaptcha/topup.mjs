// 2Captcha top-up of the stated TOPUP_USD from its pay page
// (./sign_in.mjs, ../_shared/services/balance/topup.mjs).
import { runTopup } from '../_shared/services/balance/topup.mjs';
import { TWOCAPTCHA_HOST, twocaptchaSignIn } from './sign_in.mjs';

await runTopup({
  label: 'twocaptcha_topup',
  signIn: await twocaptchaSignIn(),
  fundsUrl: `https://${TWOCAPTCHA_HOST}/pay`,
});
