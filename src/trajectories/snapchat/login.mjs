// Sign the active Snapchat account in and keep its session, through the shared
// login run (../_shared/action/login.mjs) and Snapchat's sign-in (./sign_in.mjs).
// The login counts once the web app answers the session and the declared
// Snapchat signals read the page as healthy.
import { detectSnapchatBanSignals } from '../../../dist/platforms/snapchat/ban_signals.js';
import { runLogin } from '../_shared/action/login.mjs';
import { signInToSnapchat } from './sign_in.mjs';

await runLogin({
  platform: 'snapchat',
  banDetector: detectSnapchatBanSignals,
  signIn: (s, { login, password }) => signInToSnapchat(s, login, password),
});
