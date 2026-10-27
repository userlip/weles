// Oxylabs Mobile Proxies top-up. A pay-as-you-go account buys the whole GB
// TOPUP_USD buys at the price Oxylabs's purchase dialog states
// (./topup/payg.mjs); an account on a monthly plan moves only to the plan
// OXYLABS_PLAN names, by the name Oxylabs lists it under, and only with
// OXYLABS_ALLOW_TIER_CHANGE=1 (./topup/tier.mjs). Which kind of account it
// is, and its current plan, are read from the Mobile Proxies overview.
//
// Env: TOPUP_USD, PROXY_URL (required: the proxy the browser goes through,
// or 'direct'); OXYLABS_PLAN and OXYLABS_ALLOW_TIER_CHANGE for a plan change.
import { WSession } from '../../../dist/session/wsession.js';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { getScopedGoogleLogin } from '../_shared/services/google_sso.mjs';
import { topupOpts } from '../_shared/services/topup_common.mjs';
import { purchaseEvidence } from './evidence.mjs';
import { detectCurrentPlan, statedPlan } from './topup/plans.mjs';
import { signInToDashboard } from './topup/sign_in.mjs';
import { topUpPayAsYouGo } from './topup/payg.mjs';
import { upgradeTier } from './topup/tier.mjs';

const { usd } = topupOpts();
console.log(`[trajectory] requested $${usd}`);

const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login)
  throw new Error(
    'the Oxylabs dashboard Google login is not in Skarbiec; nothing was charged',
  );
const { shot } = purchaseEvidence('oxylabs_topup');

const s = await WSession.start({
  label: 'oxylabs_topup',
  browser: 'chromium',
  proxy: statedProxy('the Oxylabs top-up'),
});
try {
  await signInToDashboard(s, login);
  const { isPayAsYouGo, currentPlanName } = await detectCurrentPlan(s);
  if (isPayAsYouGo) await topUpPayAsYouGo(s, usd);
  else await upgradeTier(s, statedPlan(), currentPlanName, shot);
} finally {
  await s.close();
}
