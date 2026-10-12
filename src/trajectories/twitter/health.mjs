import { runHealthProbe } from '../_shared/health-runner.mjs';
import { detectTwitterBanSignals } from '../../../dist/platforms/twitter/ban_signals.js';

// twitter.com's v1.1 API endpoints need an x-csrf-token header a plain
// navigation doesn't send. Probe x.com/home instead — authed users stay there,
// unauthed get redirected to /i/flow/login. Runner injects stored cookies so
// accounts with auth_token captured authenticate.
//
// Suspension is what X's ban detector read off the same session (the
// /account/access redirect, the API's own suspension codes); the logged-out
// profile is judged by its status, the runner's default. X renders both pages
// client-side, so words in the served HTML said nothing either way.
await runHealthProbe({
  platform: 'twitter',
  loggedInUrl: 'https://x.com/home',
  loggedInRegex: /x\.com\/(home|i\/flow\/login)/,
  loggedOutUrl: (u) => `https://x.com/${encodeURIComponent(u)}`,
  loggedOutRegex: /x\.com\/[^/?]+$/,
  banDetector: detectTwitterBanSignals,
  extractLoggedIn: (_body, resp) => {
    const finalUrl = resp?.url ?? '';
    const authed =
      /x\.com\/home/.test(finalUrl) && !/\/i\/flow\/login/.test(finalUrl);
    return {
      ok: authed && resp?.status === 200,
      karma: null,
      is_suspended: resp?.signal?.signal === 'suspended',
    };
  },
});
