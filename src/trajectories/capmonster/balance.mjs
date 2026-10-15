// CapMonster Cloud balance check (./sign_in.mjs, ../_shared/services/balance/run.mjs).
import { patchServiceBalance } from '../_shared/services/google_sso.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import { capmonsterSignIn } from './sign_in.mjs';

await runBalanceCheck({
  label: 'capmonster_balance',
  signIn: await capmonsterSignIn(),
  persist: (balance) => patchServiceBalance('CapMonster Cloud', balance),
});
