// Comment on the LinkedIn feed in the account character's voice, through
// the shared action runner. The comment answers the first post of the feed,
// pinned by LinkedIn's identifier for it (../../submit.mjs
// linkedinFirstPost); the text is written about that post's text and posted
// under that same post.
import { runAction } from '../../../_shared/action-runner.mjs';
import { linkedinFirstPost, linkedinSubmitComment } from '../../submit.mjs';
import { reloginLinkedinInline } from '../../../_shared/linkedin/relogin.mjs';
import { detectLinkedInBanSignals } from '../../../../../dist/platforms/linkedin/ban_signals.js';

await runAction({
  platform: 'linkedin',
  action: 'organic_comment',
  inlineRelogin: reloginLinkedinInline,
  feedUrl: 'https://www.linkedin.com/feed/',
  surfaceLabel: 'linkedin feed',
  pickPost: linkedinFirstPost,
  submitComment: linkedinSubmitComment,
  banDetector: detectLinkedInBanSignals,
});
