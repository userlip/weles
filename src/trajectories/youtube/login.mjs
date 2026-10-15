// Sign the active YouTube account in and keep its session, through the shared
// login run (../_shared/action/login.mjs): a YouTube account is a Google
// account, so it signs in on Google's sign-in for YouTube with the shared
// Google SSO steps (identifier, password, the account's own second factor).
// The login counts once Google returns the session to youtube.com and the
// declared YouTube signals read the page as healthy.
import { detectYouTubeBanSignals } from '../../../dist/platforms/youtube/ban_signals.js';
import { runLogin } from '../_shared/action/login.mjs';
import { googleSso } from '../_shared/services/google_sso.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

const SIGN_IN = 'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.youtube.com%2F';

await runLogin({
  platform: 'youtube',
  banDetector: detectYouTubeBanSignals,
  signIn: async (s, { acct, login, password }) => {
    await s.goto(SIGN_IN);
    await pageSettled(s.page);
    const creds = { email: login, password, metadata: acct.metadata };
    if (!(await googleSso(s, creds, { originHost: 'youtube.com' })))
      throw new Error(`YOUTUBE_SIGN_IN_FAILED: Google did not return ${login} to YouTube (at ${s.page.url()})`);
  },
});
