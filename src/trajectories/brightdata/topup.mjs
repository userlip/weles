// Bright Data top-up (../_shared/services/balance/topup.mjs), signed in
// through ./sign_in.mjs. The billing flow's first-login survey and onboarding
// popups, which lie over its form, are each closed; the stated amount
// (TOPUP_USD, with TOPUP_CONFIRM) is then typed into the amount field and
// read back before the pay button charges the saved payment method.
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { runTopup } from '../_shared/services/balance/topup.mjs';
import { brightdataSignIn } from './sign_in.mjs';

await runTopup({
  label: 'brightdata_topup',
  signIn: brightdataSignIn,
  fundsUrl: 'https://brightdata.com/cp/billing_flow?type=top_up',
  clearPage: async (s) => {
    while (
      await clickOffered(
        s.page,
        'the button that closes or skips a survey or onboarding popup',
      )
    )
      await pageSettled(s.page);
  },
});
