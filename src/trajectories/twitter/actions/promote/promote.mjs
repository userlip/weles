// Reply naming the character's promoted product, through the shared action
// runner. The reply answers the first post of the page it lands on (the
// home feed, TARGET_URL, a TARGET_USER profile or a SEARCH_QUERY hashtag),
// and the text is written about that same post.
import { runAction } from '../../../_shared/action-runner.mjs';
import { twitterFirstPost, twitterSubmitReply } from '../../submit.mjs';
import { detectTwitterBanSignals } from '../../../../../dist/platforms/twitter/ban_signals.js';

await runAction({
  platform: 'twitter',
  action: 'promote',
  feedUrl: 'https://x.com/home',
  surfaceLabel: 'x.com feed',
  resolveUserUrl: (u) => `https://x.com/${u.replace(/^@/, '')}`,
  resolveSearchUrl: (q) =>
    `https://x.com/hashtag/${encodeURIComponent(q.replace(/^#/, ''))}`,
  pickPost: twitterFirstPost,
  submitComment: twitterSubmitReply,
  submitTargetedComment: twitterSubmitReply,
  banDetector: detectTwitterBanSignals,
});
