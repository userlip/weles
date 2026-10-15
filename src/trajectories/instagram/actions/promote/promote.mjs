// Comment naming the character's promoted product on an Instagram post,
// through the shared action runner. The post is the first one the landing
// page links (Explore, TARGET_URL, a TARGET_USER profile or a SEARCH_QUERY
// hashtag; ../../submit.mjs instagramPost); the text is written about its
// caption and posted under that same post.
import { runAction } from '../../../_shared/action-runner.mjs';
import { instagramPost, instagramSubmitComment } from '../../submit.mjs';
import { detectInstagramBanSignals } from '../../../../../dist/platforms/instagram/ban_signals.js';

await runAction({
  platform: 'instagram',
  action: 'promote',
  feedUrl: 'https://www.instagram.com/explore/',
  surfaceLabel: 'instagram explore',
  resolveUserUrl: (u) => `https://www.instagram.com/${u.replace(/^@/, '')}/`,
  resolveSearchUrl: (q) =>
    `https://www.instagram.com/explore/tags/${encodeURIComponent(q.replace(/^#/, ''))}/`,
  pickPost: instagramPost,
  submitComment: instagramSubmitComment,
  submitTargetedComment: instagramSubmitComment,
  banDetector: detectInstagramBanSignals,
});
