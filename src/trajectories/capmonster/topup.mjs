// CapMonster Cloud top-up of the stated TOPUP_USD from its Add Funds page
// (./sign_in.mjs, ../_shared/services/balance/topup.mjs).
import { runTopup } from '../_shared/services/balance/topup.mjs';
import { capmonsterSignIn } from './sign_in.mjs';

await runTopup({
  label: 'capmonster_topup',
  signIn: await capmonsterSignIn(),
  fundsUrl: 'https://dash.capmonster.cloud/Profile/AddFunds',
});
