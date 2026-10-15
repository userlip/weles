// FiveSim (5sim.net) top-up of the stated TOPUP_USD from its finance page
// (./sign_in.mjs, ../_shared/services/balance/topup.mjs).
import { runTopup } from '../_shared/services/balance/topup.mjs';
import { FIVESIM_HOST, fivesimSignIn } from './sign_in.mjs';

await runTopup({
  label: 'fivesim_topup',
  signIn: await fivesimSignIn(),
  fundsUrl: `https://${FIVESIM_HOST}/finance`,
});
