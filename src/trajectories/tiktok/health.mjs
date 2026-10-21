import { runHealthProbe } from '../_shared/health-runner.mjs';
import { detectTikTokBanSignals } from '../../../dist/platforms/tiktok/ban_signals.js';
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
} from '../../worker/weles-api-server/routes/http-status.mjs';

// TikTok's profile page carries the profile it found in its own rehydration
// state (the __UNIVERSAL_DATA_FOR_REHYDRATION__ JSON, user detail under
// webapp.user-detail); a profile TikTok could not find carries no user there.
const REHYDRATION =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application\/json">(?<state>[\s\S]*?)<\/script>/;

/**
 * Whether the signed-out profile page shows the profile: true when its
 * rehydration state names the user, false when the state names none, null
 * when the page carries no state (it cannot tell). A state that is not JSON
 * fails the probe with its parse error.
 */
function profileFound(html) {
  const found = REHYDRATION.exec(html);
  if (found === null) {
    console.error(
      '[health:tiktok] the profile page carries no rehydration state; its visibility cannot be read',
    );
    return null;
  }
  let data;
  try {
    data = JSON.parse(found.groups.state);
  } catch (error) {
    throw new Error(
      `HEALTH_VISIBILITY_UNREADABLE: TikTok's profile page carries a rehydration state that is not JSON: ${error.message}`,
      { cause: error },
    );
  }
  const user = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo?.user;
  return typeof user?.uniqueId === 'string' && user.uniqueId !== '';
}

/** Visibility from the signed-out read: the page's state, a missing profile, or cannot tell. */
function visibleSignedOut(resp) {
  if (resp.status === HTTP_NOT_FOUND) return false;
  if (resp.status !== HTTP_OK || typeof resp.body !== 'string') return null;
  return profileFound(resp.body);
}

// Probe the /foryou document — a signed-in account is served the feed there,
// a signed-out one is redirected away. Runner injects stored cookies
// (sessionid, sid_guard). Suspension is what TikTok's ban detector read off
// the same session.
await runHealthProbe({
  platform: 'tiktok',
  loggedInUrl: 'https://www.tiktok.com/foryou',
  loggedInRegex: /^https:\/\/www\.tiktok\.com\/foryou/,
  loggedOutUrl: (u) => `https://www.tiktok.com/@${encodeURIComponent(u)}`,
  // Allow trailing query params (TikTok auto-appends ?lang=en-GB and others)
  // and trailing slash. Must be permissive enough to catch the profile-page
  // response post-redirect; otherwise capturedResponses.find() returns
  // nothing and the probe cannot read visibility.
  loggedOutRegex: /tiktok\.com\/@[^/?]+(?:[/?#].*)?$/,
  banDetector: detectTikTokBanSignals,
  extractLoggedIn: (_body, resp) => ({
    ok: resp.status === HTTP_OK,
    karma: null,
    is_suspended: resp.signal?.signal === 'suspended',
  }),
  extractLoggedOut: visibleSignedOut,
});
