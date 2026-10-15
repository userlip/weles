// Capsolver balance check (./sign_in.mjs, ../_shared/services/balance/run.mjs).
import { patchServiceBalance } from '../_shared/services/google_sso.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import { capsolverSignIn } from './sign_in.mjs';

await runBalanceCheck({
  label: 'capsolver_balance',
  signIn: await capsolverSignIn(),
  persist: (balance) => patchServiceBalance('Capsolver', balance),
});
