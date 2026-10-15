// Oxylabs balance check via the Google button its dashboard draws in a GSI
// frame, which opens Google's sign-in in a popup, on the shared balance run
// (../_shared/services/balance/run.mjs). Oxylabs sells prepaid traffic, not
// a dollar wallet: the overview's remaining traffic (in GB) is the balance,
// written to both the Residential and the Mobile proxy record. KEEP_OPEN=1
// leaves the browser for review.
import { getScopedGoogleLogin } from '../_shared/services/google_sso.mjs';
import { patchEffectiveBalance } from '../_shared/services/proxy_probe.mjs';
import { shownText } from '../_shared/page/judged/seen.mjs';
import { runGoogleSsoBalance } from '../_shared/services/balance/run.mjs';

await runGoogleSsoBalance({
  label: 'oxylabs_balance',
  login: await getScopedGoogleLogin('oxylabsDashboard'),
  loginUrl: 'https://dashboard.oxylabs.io/',
  controlFrame: 'gsi/button',
  googleControl: 'div[role="button"]',
  originHost: 'oxylabs.io',
  popup: true,
  // Signed in is anywhere but the dashboard's bare entry page.
  signedInUrl: /^(?!https:\/\/dashboard\.oxylabs\.io\/en\/?(\?.*)?$)/,
  readBalance: async (s) => {
    // The overview's remaining allowance, not a product tab's used/total.
    const traffic = await shownText(s.page, 'remaining traffic available on the active plan, in GB (the number alone)');
    const number = traffic?.replace(/,/g, '').match(/\d+(?:\.\d+)?/)?.shift();
    return number === undefined ? null : Number(number);
  },
  persist: async (balance) => {
    const residential = await patchEffectiveBalance('Oxylabs Residential', balance);
    const mobile = await patchEffectiveBalance('Oxylabs Mobile', balance);
    if (residential !== mobile)
      throw new Error(`OXYLABS_BALANCE_HALF_PERSISTED: residential=${residential} mobile=${mobile}`);
    return residential;
  },
});
