// NopeCHA's sign-in: the homepage's Sign in opens a modal offering "Continue
// with Google", which navigates the tab itself (server-side OAuth, no popup).
import { getGoogleSsoCreds } from '../_shared/services/google_sso.mjs';
import { googleSignIn } from '../_shared/services/balance/run.mjs';

export const nopechaSignIn = async () =>
  googleSignIn({
    login: await getGoogleSsoCreds(),
    loginUrl: 'https://nopecha.com/',
    openControl: 'a:has-text("Sign in")',
    googleControl: 'button:has-text("Continue with Google")',
    originHost: 'nopecha.com',
  });
