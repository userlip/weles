// FiveSim (5sim.net) balance check (./sign_in.mjs, ../_shared/services/balance/run.mjs).
import { patchServiceBalance } from '../_shared/services/google_sso.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import { fivesimSignIn } from './sign_in.mjs';

await runBalanceCheck({
  label: 'fivesim_balance',
  signIn: await fivesimSignIn(),
  persist: (balance) => patchServiceBalance('FiveSim', balance),
});
