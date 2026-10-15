// SadCaptcha top-up of the stated TOPUP_USD from its dashboard
// (./sign_in.mjs, ../_shared/services/balance/topup.mjs).
import { runTopup } from '../_shared/services/balance/topup.mjs';
import { SADCAPTCHA_DASHBOARD, sadcaptchaSignIn } from './sign_in.mjs';

await runTopup({
  label: 'sadcaptcha_topup',
  signIn: await sadcaptchaSignIn(),
  fundsUrl: SADCAPTCHA_DASHBOARD,
});
