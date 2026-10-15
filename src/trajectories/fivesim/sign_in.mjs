// FiveSim (5sim.net) sign-in: the /login modal offers "Sign in with Google"
// beside its own form and Cloudflare Turnstile, opening Google in a popup;
// the OAuth round trip lands back on a 5sim.net route other than /login.
import { getGoogleSsoCreds } from '../_shared/services/google_sso.mjs';
import { googleSignIn } from '../_shared/services/balance/run.mjs';

export const FIVESIM_HOST = '5sim.net';

export const fivesimSignIn = async () =>
  googleSignIn({
    login: await getGoogleSsoCreds(),
    loginUrl: `https://${FIVESIM_HOST}/login`,
    googleControl: 'button:has-text("Sign in with Google"), a:has-text("Sign in with Google")',
    originHost: FIVESIM_HOST,
    popup: true,
    signedInUrl: (url) => new URL(url).hostname.endsWith(FIVESIM_HOST) && !new URL(url).pathname.startsWith('/login'),
  });
