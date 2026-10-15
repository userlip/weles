// Comment naming the character's promoted product on a TikTok video,
// through the shared action runner. The video is the first one the landing
// page leads to (the For You feed, TARGET_URL, a TARGET_USER profile or a
// SEARCH_QUERY hashtag; ../../rail.mjs videoPost); the text is written about
// its caption and posted under that same video.
import { runAction } from '../../../_shared/action-runner.mjs';
import { tiktokSubmitComment } from '../../submit.mjs';
import { TIKTOK_ORIGIN, videoPost } from '../../rail.mjs';
import { detectTikTokBanSignals } from '../../../../../dist/platforms/tiktok/ban_signals.js';

await runAction({
  platform: 'tiktok',
  action: 'promote',
  feedUrl: `${TIKTOK_ORIGIN}/foryou`,
  surfaceLabel: 'tiktok fyp',
  resolveUserUrl: (u) => `${TIKTOK_ORIGIN}/@${encodeURIComponent(u.replace(/^@/, ''))}`,
  resolveSearchUrl: (q) =>
    `${TIKTOK_ORIGIN}/tag/${encodeURIComponent(q.replace(/^#/, ''))}`,
  pickPost: videoPost,
  submitComment: tiktokSubmitComment,
  submitTargetedComment: tiktokSubmitComment,
  banDetector: detectTikTokBanSignals,
});
