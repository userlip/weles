// IPRoyal balance check (./sign_in.mjs, ../_shared/services/balance/run.mjs).
// The dashboard's balance is written as the effective balance of both the
// Residential and the Mobile proxy record.
import { patchEffectiveBalance } from '../_shared/services/proxy_probe.mjs';
import { runBalanceCheck } from '../_shared/services/balance/run.mjs';
import {
  IPROYAL_DASHBOARD,
  IPROYAL_SESSION,
  iproyalSignIn,
} from './sign_in.mjs';

await runBalanceCheck({
  label: 'iproyal_balance',
  session: IPROYAL_SESSION,
  signIn: await iproyalSignIn(),
  balanceUrl: IPROYAL_DASHBOARD,
  persist: async (balance) => {
    const residential = await patchEffectiveBalance(
      'IPRoyal Residential',
      balance,
    );
    const mobile = await patchEffectiveBalance('IPRoyal Mobile', balance);
    if (residential !== mobile)
      throw new Error(
        `IPROYAL_BALANCE_HALF_PERSISTED: residential=${residential} mobile=${mobile}`,
      );
    return residential;
  },
});
