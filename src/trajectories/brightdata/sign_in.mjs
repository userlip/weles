// Signing in to the Bright Data dashboard. The account was created with
// Google SSO, so the customer portal refuses a password login; the Google
// identity is the dedicated Bright Data Skarbiec consumer's.
import { getScopedGoogleLogin } from '../_shared/services/google_sso.mjs';
import { googleSignIn } from '../_shared/services/balance/run.mjs';

const login = await getScopedGoogleLogin('brightdataDashboard');
if (!login) throw new Error('BRIGHTDATA_LOGIN_UNAVAILABLE: the scoped Bright Data dashboard login cannot be read');

export const BRIGHTDATA_GOOGLE = {
  login,
  loginUrl: 'https://brightdata.com/cp/login',
  googleControl: 'button:has-text("Log in with Google")',
  originHost: 'brightdata.com',
};

/** Signs a session in to the Bright Data dashboard (s, code). */
export const brightdataSignIn = googleSignIn(BRIGHTDATA_GOOGLE);
