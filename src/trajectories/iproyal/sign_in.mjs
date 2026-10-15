// IPRoyal's sign-in. Its "Login with Google" button loads Google Identity
// Services conditionally, and in the Weles Chromium build the button often
// renders without a working handler; so the OAuth code flow is started
// directly with IPRoyal's own client and redirect, the shared Google SSO
// driver signs in, and Google redirects back to /social-login/google/success.
import { getGoogleSsoCreds, googleSso } from '../_shared/services/google_sso.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

export const IPROYAL_DASHBOARD = 'https://dashboard.iproyal.com/';
// IPRoyal's own Google OAuth client and redirect, as its login page declares them.
const GOOGLE_OAUTH_URL =
  'https://accounts.google.com/o/oauth2/v2/auth?client_id=979254173035-cnuh89fv3k3285biuma7pk77ptup1t9b.apps.googleusercontent.com&redirect_uri=https://dashboard.iproyal.com/social-login/google/success&response_type=code&scope=email%20openid%20profile';
// The session IPRoyal's Google flow is driven in.
export const IPROYAL_SESSION = { os: 'windows' };

export async function iproyalSignIn() {
  const login = await getGoogleSsoCreds();
  return async (s, code) => {
    console.log(`[trajectory] Using Google SSO: ${login.email}`);
    await s.page.goto(GOOGLE_OAUTH_URL, { waitUntil: 'domcontentloaded' });
    await pageSettled(s.page);
    if (!(await googleSso(s, login, { originHost: 'iproyal.com' })))
      throw new Error(`${code}_SSO_INCOMPLETE: Google sign-in did not return to iproyal.com; observed ${s.page.url()}`);
  };
}
