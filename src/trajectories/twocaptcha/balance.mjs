// 2Captcha balance check (./sign_in.mjs, ../_shared/services/balance/run.mjs).
import { patchServiceBalance } from '../_shared/services/google_sso.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import { twocaptchaSignIn } from './sign_in.mjs';

await runBalanceCheck({
  label: 'twocaptcha_balance',
  signIn: await twocaptchaSignIn(),
  persist: (balance) => patchServiceBalance('2Captcha', balance),
});
