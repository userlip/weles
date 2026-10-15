// NopeCHA top-up of the stated TOPUP_USD from its subscribe page
// (./sign_in.mjs, ../_shared/services/balance/topup.mjs).
import { runTopup } from '../_shared/services/balance/topup.mjs';
import { nopechaSignIn } from './sign_in.mjs';

await runTopup({
  label: 'nopecha_topup',
  signIn: await nopechaSignIn(),
  fundsUrl: 'https://nopecha.com/subscribe',
});
