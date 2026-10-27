// SadCaptcha balance check (./sign_in.mjs, ../_shared/services/balance/run.mjs).
// The balance is read on the dashboard, which must be exactly the dashboard
// route once signed in.
import { patchServiceBalance } from '../_shared/services/google_sso.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import { SADCAPTCHA_DASHBOARD, sadcaptchaSignIn } from './sign_in.mjs';

await runBalanceCheck({
  label: 'sadcaptcha_balance',
  signIn: await sadcaptchaSignIn(),
  balanceUrl: SADCAPTCHA_DASHBOARD,
  onBalancePage: (url) =>
    url.origin === new URL(SADCAPTCHA_DASHBOARD).origin &&
    url.pathname === new URL(SADCAPTCHA_DASHBOARD).pathname,
  persist: (balance) => patchServiceBalance('SadCaptcha', balance),
});
