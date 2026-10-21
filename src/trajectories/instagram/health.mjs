import { runHealthProbe } from '../_shared/health-runner.mjs';
import { detectInstagramBanSignals } from '../../../dist/platforms/instagram/ban_signals.js';
import { HTTP_OK } from '../../worker/weles-api-server/routes/http-status.mjs';

// instagram.com/api/v1/* endpoints need an x-ig-app-id + x-csrftoken header
// set. Probe the root /feed — authed users stay on instagram.com, unauthed
// get redirected to /accounts/login/. A public profile declares itself in its
// Open Graph metadata (og:type profile, https://ogp.me/#types), which
// Instagram serves to a signed-out reader as well.
const PROFILE_OPEN_GRAPH = /property="og:type"\s+content="profile"/;

await runHealthProbe({
  platform: 'instagram',
  loggedInUrl: 'https://www.instagram.com/',
  loggedInRegex: /instagram\.com\/($|\?|accounts\/login)/,
  loggedOutUrl: (u) => `https://www.instagram.com/${encodeURIComponent(u)}/`,
  loggedOutRegex: /instagram\.com\/[^/?]+\/$/,
  banDetector: detectInstagramBanSignals,
  extractLoggedIn: (_body, resp) => ({
    ok:
      resp.status === HTTP_OK &&
      !new URL(resp.url).pathname.startsWith('/accounts/login'),
    karma: null,
    is_suspended: resp.signal?.signal === 'suspended',
  }),
  extractLoggedOut: (resp) =>
    resp.status === HTTP_OK &&
    typeof resp.body === 'string' &&
    PROFILE_OPEN_GRAPH.test(resp.body),
});
