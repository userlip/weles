// Pingproxies (rebranded as Byteful) balance check via Google SSO from
// dashboard.byteful.com/login (../_shared/services/balance/run.mjs). The
// balance is written as the proxy record's effective balance.
import { getGoogleSsoCreds } from '../_shared/services/google_sso.mjs';
import { patchEffectiveBalance } from '../_shared/services/proxy_probe.mjs';
import { runGoogleSsoBalance } from '../_shared/services/balance/run.mjs';

await runGoogleSsoBalance({
  label: 'pingproxies_balance',
  login: await getGoogleSsoCreds(),
  loginUrl: 'https://dashboard.byteful.com/login',
  googleControl:
    'button:has-text("Continue with Google"), button:has-text("Sign in with Google")',
  originHost: 'byteful.com',
  persist: (balance) => patchEffectiveBalance('Pingproxies', balance),
});
