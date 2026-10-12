import { runHealthProbe } from '../_shared/health-runner.mjs';
import { detectTikTokBanSignals } from '../../../dist/platforms/tiktok/ban_signals.js';

// TikTok's profile page carries the profile it found in its own rehydration
// state (the __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON, user detail under
// webapp.user-detail); a profile TikTok could not find carries no user there.
const REHYDRATION =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(?<state>[\s\S]*?)<\/script>/;

function profileFound(html) {
  const found = REHYDRATION.exec(html);
  if (found === null) return false;
  let data;
  try {
    data = JSON.parse(found.groups.state);
  } catch (error) {
    console.error(
      `[health:tiktok] the profile page's rehydration state is not JSON: ${error.message}`,
    );
    return false;
  }
  const user = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
  return typeof user?.uniqueId === 'string' && user.uniqueId !== '';
}

// Probe /foryou — authed accounts see the feed, unauthed get redirected or
// shown a login prompt. Runner injects stored cookies (sessionid, sid_guard).
// Suspension is what TikTok's ban detector read off the same session.
await runHealthProbe({
  platform: 'tiktok',
  loggedInUrl: 'https://www.tiktok.com/foryou',
  loggedInRegex: /tiktok\.com\/(foryou|login)/,
  loggedOutUrl: (u) => `https://www.tiktok.com/@${encodeURIComponent(u)}`,
  // Allow trailing query params (TikTok auto-appends ?lang=en-GB and others)
  // and trailing slash. Must be permissive enough to catch the profile-page
  // response post-redirect; otherwise capturedResponses.find() returns
  // nothing and the probe falsely reports shadowbanned.
  loggedOutRegex: /tiktok\.com\/@[^/?]+(?:[/?#].*)?$/,
  banDetector: detectTikTokBanSignals,
  extractLoggedIn: (_body, resp) => {
    const authed =
      typeof resp?.url === 'string' &&
      /\/foryou/.test(resp.url) &&
      !/\/login/.test(resp.url);
    return {
      ok: authed && resp?.status === 200,
      karma: null,
      is_suspended: resp?.signal?.signal === 'suspended',
    };
  },
  extractLoggedOut: (resp) =>
    resp.status === 200 &&
    typeof resp.body === 'string' &&
    profileFound(resp.body),
});
