// Comment naming the character's promoted product on LinkedIn, through the
// shared action runner. The comment answers the first post of the landing
// page (the feed, TARGET_URL, a TARGET_USER profile or a SEARCH_QUERY
// hashtag), pinned by LinkedIn's identifier for it (../../submit.mjs
// linkedinFirstPost); the text is written about that post's text and posted
// under that same post.
import { runAction } from '../../../_shared/action-runner.mjs';
import { linkedinFirstPost, linkedinSubmitComment } from '../../submit.mjs';
import { reloginLinkedinInline } from '../../../_shared/linkedin/relogin.mjs';
import { detectLinkedInBanSignals } from '../../../../../dist/platforms/linkedin/ban_signals.js';

await runAction({
  platform: 'linkedin',
  action: 'promote',
  inlineRelogin: reloginLinkedinInline,
  feedUrl: 'https://www.linkedin.com/feed/',
  surfaceLabel: 'linkedin feed',
  resolveUserUrl: (u) => `https://www.linkedin.com/in/${u.replace(/^@/, '')}/`,
  resolveSearchUrl: (q) =>
    `https://www.linkedin.com/feed/hashtag/${encodeURIComponent(q.replace(/^#/, ''))}/`,
  pickPost: linkedinFirstPost,
  submitComment: linkedinSubmitComment,
  submitTargetedComment: linkedinSubmitComment,
  banDetector: detectLinkedInBanSignals,
});
