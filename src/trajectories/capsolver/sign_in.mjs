// Capsolver's sign-in: its Google control opens Google's sign-in in a popup,
// and signed in is any address off the passport login page.
import { getGoogleSsoCreds } from '../_shared/services/google_sso.mjs';
import { googleSignIn } from '../_shared/services/balance/run.mjs';

export const capsolverSignIn = async () =>
  googleSignIn({
    login: await getGoogleSsoCreds(),
    loginUrl: 'https://dashboard.capsolver.com/passport/login',
    googleControl: 'button:has-text("Sign In With Google")',
    originHost: 'capsolver.com',
    popup: true,
    signedInUrl: /^(?!.*\/passport\/login)/,
  });
