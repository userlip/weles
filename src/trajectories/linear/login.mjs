// Linear sign-in through Google: linear.app/login → the Google button →
// Google's sign-in steps (`_shared/keeper/google_sign_in.mjs`, driven in
// process) → back on Linear. The login is the Linear dashboard's scoped
// Skarbiec grant.
//
// Signed in is read from where Linear sends the browser: a signed-in session
// is taken off the login route to its workspace, a signed-out one stays on
// it. Every refusal is thrown with the address and the Google steps seen.
//
// Env: PROXY_URL (required: the proxy the browser goes through, or 'direct').
//
// Run: node src/trajectories/linear/login.mjs
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import { WSession } from '../../../dist/session/wsession.js';
import { statedProxy } from '../_shared/inputs/stated.mjs';
import { signInThroughKeeper } from '../_shared/keeper/google_sign_in.mjs';
import { sessionAct } from '../_shared/keeper/session_act.mjs';

const LABEL = 'linear_login';
const LOGIN_URL = new URL('https://linear.app/login');
const login = readScopedLogin('linearDashboard');
console.log(`[linear-login] credentials from skarbiec: ${login.email}`);

/** Whether the browser is on Linear, off its login route. */
function signedIn(address) {
  const url = new URL(address);
  return (
    url.hostname === LOGIN_URL.hostname &&
    !url.pathname.startsWith(LOGIN_URL.pathname)
  );
}

const s = await WSession.start({
  label: LABEL,
  browser: 'chromium',
  proxy: statedProxy('the Linear sign-in'),
});
try {
  const act = sessionAct(s, LABEL);
  await act({ action: 'nav', url: LOGIN_URL.href });
  await act({ action: 'settle' });
  if (signedIn(s.page.url())) {
    console.log(`PASS: already signed in, landed on ${s.page.url()}`);
  } else {
    await act({
      action: 'click_described',
      description: 'the button that continues to Linear with Google',
    });
    await act({ action: 'settle' });
    const steps = await signInThroughKeeper(act, login);
    await act({ action: 'settle' });
    if (!signedIn(s.page.url()))
      throw new Error(
        `LINEAR_NOT_SIGNED_IN: Google let the browser go but Linear left it at ${s.page.url()}; Google steps: ${JSON.stringify(steps)}`,
      );
    console.log(`PASS: landed on ${s.page.url()}`);
  }
} finally {
  await s.close();
}
