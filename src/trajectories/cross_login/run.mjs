// Parametric cross-login runner.
//
// Action: <platform>_login_via_<provider>. dispatch.ts resolves it to this
// file with PLATFORM and PROVIDER set from the action name; the shared runner
// (../_shared/oauth/cross_login.mjs) signs the platform's account in through
// the provider's control on the platform's login page, which it finds by
// vision. A platform needs only its login page below; any provider the page
// offers works without a row of its own.
import { runCrossLogin } from '../_shared/oauth/cross_login.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';

// Where each platform's sign-in starts (Product Hunt opens it from its
// homepage).
const LOGIN_PAGES = {
  reddit: 'https://www.reddit.com/login',
  tiktok: 'https://www.tiktok.com/login',
  twitter: 'https://x.com/i/flow/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  linkedin: 'https://www.linkedin.com/login',
  github: 'https://github.com/login',
  snapchat: 'https://accounts.snapchat.com/accounts/login',
  producthunt: 'https://www.producthunt.com/',
  threads: 'https://www.threads.net/login',
};

const platform = statedText(['PLATFORM'], 'the platform signed in to (the action name before _login_via_)');
const provider = statedText(['PROVIDER'], 'the platform whose account signs in (the action name after _login_via_)');
if (!Object.hasOwn(LOGIN_PAGES, platform))
  throw new Error(`CROSS_LOGIN_PLATFORM_UNKNOWN: no login page is known for ${platform}; add it to LOGIN_PAGES`);

await runCrossLogin({ targetPlatform: platform, targetUrl: LOGIN_PAGES[platform], provider });
