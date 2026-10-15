// Capsolver top-up of the stated TOPUP_USD from its recharge page
// (./sign_in.mjs, ../_shared/services/balance/topup.mjs).
import { runTopup } from '../_shared/services/balance/topup.mjs';
import { capsolverSignIn } from './sign_in.mjs';

await runTopup({
  label: 'capsolver_topup',
  signIn: await capsolverSignIn(),
  fundsUrl: 'https://dashboard.capsolver.com/dashboard/recharge',
});
