// Canonical Apple ID login into App Store Connect: one guarded run
// (guarded/run.mjs) whose three one-use Skarbiec capabilities permit the
// email, password and 2FA operations, signed in once (guarded/sign_in.mjs).
// Stado owns execution and placement.
//
// The login document is loaded directly: the unauthenticated root shell
// references protected /access/static assets that App Store Connect answers
// with HTML login responses, so the shell never bootstraps the idmsa frame.
import { pageSettled } from '../_shared/page/settled.mjs';
import { runGuarded } from './guarded/run.mjs';
import { signInGuarded } from './guarded/sign_in.mjs';

const LOGIN_URL = 'https://appstoreconnect.apple.com/login?targetUrl=%2Fapps&authResult=FAILED';
const DASHBOARD = new URL(LOGIN_URL);

/** On App Store Connect, off its login route. */
const onDashboard = (url) => url.hostname === DASHBOARD.hostname && !url.pathname.startsWith(DASHBOARD.pathname);

await runGuarded({
  label: 'apple_login',
  prefix: '[apple-login]',
  act: async (s, guard) => {
    await s.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
    await pageSettled(s.page);
    await signInGuarded(s, guard, onDashboard, '[apple-login]');
    const at = new URL(s.page.url());
    return `Authenticated App Store Connect dashboard observed at origin=${at.origin} pathname=${at.pathname}`;
  },
});
