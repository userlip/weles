// Bright Data balance check (../_shared/services/balance/run.mjs), signed in
// through ./sign_in.mjs; Bright Data lists the balance on its billing page.
// The balance is written as the proxy record's effective balance.
import { patchEffectiveBalance } from '../_shared/services/proxy_probe.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import { brightdataSignIn } from './sign_in.mjs';

await runBalanceCheck({
  label: 'brightdata_balance',
  signIn: brightdataSignIn,
  balanceUrl: 'https://brightdata.com/cp/setting/billing',
  persist: (balance) => patchEffectiveBalance('Bright Data', balance),
});
