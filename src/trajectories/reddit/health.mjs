/**
 * Reddit account health probe, run by the shared health runner
 * (`../_shared/health-runner.mjs`).
 *
 * Signed in: reddit.com/api/me.json with the account's persona, proxy and
 *   cookies; a populated name proves the session, and the body carries karma
 *   and suspension.
 * Signed out (shadowban check): /user/<name>/about.json in a fresh session,
 *   for the name Reddit gave the account. A profile Reddit answers as not
 *   found while the signed-in read is ok is a shadowban; an edge refusal
 *   (anything but found or not found) cannot tell.
 * An exit Reddit's edge blocks is cleared from the account, so the next run
 *   rolls a fresh one instead of reusing the burned address.
 */
import { detectRedditBanSignals } from '../../../dist/platforms/reddit/ban_signals.js';
import { runHealthProbe } from '../_shared/health-runner.mjs';
import { replaceAccountMetadata } from '../_shared/skarbiec/accounts.mjs';
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
} from '../../worker/weles-api-server/routes/http-status.mjs';

/** The name Reddit gave the account, from its signed-in me.json read. */
function redditName(body) {
  return body && typeof body === 'object' && body.data ? body.data.name : null;
}

await runHealthProbe({
  platform: 'reddit',
  loggedInUrl: 'https://www.reddit.com/api/me.json',
  loggedInRegex: /\/api\/me\.json/,
  // Reddit auto-assigns names on signup that need not match the stored
  // username; the signed-in read names the account's real one.
  loggedOutUrl: (username, signedIn) =>
    `https://www.reddit.com/user/${encodeURIComponent(redditName(signedIn.body) ? redditName(signedIn.body) : username)}/about.json`,
  loggedOutRegex: /\/user\/.+\/about\.json/,
  banDetector: detectRedditBanSignals,
  extractLoggedIn: (body) => ({
    ok: Boolean(redditName(body)),
    karma: redditName(body) ? body.data.total_karma : null,
    is_suspended: redditName(body) ? body.data.is_suspended === true : null,
  }),
  extractLoggedOut: (response) =>
    response.status === HTTP_OK
      ? Boolean(redditName(response.body))
      : response.status === HTTP_NOT_FOUND
        ? false
        : null,
  afterProbe: async (snapshot, acct) => {
    if (snapshot.signal !== 'ip_blocked' || !acct.id) return;
    const { proxy: burned, ...metadata } = acct.metadata;
    replaceAccountMetadata(acct.id, metadata);
    console.log(
      `[proxy-rotate] account ${acct.id}: stored proxy ${burned ? 'cleared' : 'was already absent'} — next run will re-roll`,
    );
  },
});
