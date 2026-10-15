// Like a TikTok video through the shared action runner: the account's fresh
// jar, the signed-in gate, the verdict and its record are the runner's.
//
// Env (one is required; nothing is liked from the For You feed):
//   TARGET_URL     a video, or a page whose first video is liked
//   TARGET_USER    a profile whose first video is liked (@ optional)
//   SEARCH_QUERY   a hashtag whose first video is liked (# optional)
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { TIKTOK_ORIGIN, openVideo, switchRailOn } from '../rail.mjs';

await runAction({
  platform: 'tiktok',
  action: 'like',
  resolveUserUrl: (user) =>
    `${TIKTOK_ORIGIN}/@${encodeURIComponent(user.trim().replace(/^@/, ''))}`,
  resolveSearchUrl: (query) =>
    `${TIKTOK_ORIGIN}/tag/${encodeURIComponent(query.trim().replace(/^#/, ''))}`,
  banDetector: detectTikTokBanSignals,
  act: async (s) => {
    await openVideo(s);
    const liked = await switchRailOn(
      s.page,
      'button[data-e2e="like-icon"], button[data-e2e="browse-like-icon"], button:has([data-e2e="like-icon"]), button:has([data-e2e="browse-like-icon"])',
      'like',
    );
    return liked ? `already liked ${s.page.url()}` : `liked ${s.page.url()}`;
  },
});
