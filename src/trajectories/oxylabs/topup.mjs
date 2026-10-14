// Oxylabs topup via Google GSI iframe + popup OAuth. A pay-as-you-go account
// buys exactly TOPUP_USD of traffic; an account on a monthly tier moves only
// to the plan OXYLABS_PLAN names (Starter, Basic, Standard or Advanced),
// never to the plan priced nearest an amount. TOPUP_CONFIRM=1 proceeds to
// checkout.
import { WSession } from '../../../dist/session/wsession.js';
import { getScopedGoogleLogin } from '../_shared/services/google_sso.mjs';
import { topupOpts } from '../_shared/services/topup_common.mjs';
import { detectCurrentPlan, statedPlan } from './topup/plans.mjs';
import { signInToDashboard } from './topup/sign_in.mjs';
import { topUpPayAsYouGo } from './topup/payg.mjs';
import { upgradeTier } from './topup/tier.mjs';

const { usd } = topupOpts();
console.log(`[trajectory] requested $${usd}`);

const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login) {
  console.log('FAIL: no Google SSO creds');
  process.exit(1);
}

const s = await WSession.start({ label: 'oxylabs_topup', browser: 'chromium' });
try {
  await signInToDashboard(s, login);
  const { isPayAsYouGo, currentPlanName } = await detectCurrentPlan(s);
  if (isPayAsYouGo) await topUpPayAsYouGo(s, usd);
  else await upgradeTier(s, statedPlan(), currentPlanName);
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
