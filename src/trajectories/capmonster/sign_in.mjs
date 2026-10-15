// CapMonster Cloud's sign-in: Google SSO through Keycloak, which renders each
// identity provider's link as #social-<alias>.
import { getGoogleSsoCreds } from '../_shared/services/google_sso.mjs';
import { googleSignIn } from '../_shared/services/balance/run.mjs';

export const capmonsterSignIn = async () =>
  googleSignIn({
    login: await getGoogleSsoCreds(),
    loginUrl: 'https://dash.capmonster.cloud/?culture=en',
    googleControl: 'a#social-google',
    originHost: 'capmonster.cloud',
  });
