// Comment on an Instagram post in the account character's voice, through
// the shared action runner. The post is the first one Explore links
// (../../submit.mjs instagramPost); the text is written about its caption and
// posted under that same post.
import { runAction } from '../../../_shared/action-runner.mjs';
import { instagramPost, instagramSubmitComment } from '../../submit.mjs';
import { detectInstagramBanSignals } from '../../../../../dist/platforms/instagram/ban_signals.js';

await runAction({
  platform: 'instagram',
  action: 'organic_comment',
  feedUrl: 'https://www.instagram.com/explore/',
  surfaceLabel: 'instagram explore',
  pickPost: instagramPost,
  submitComment: instagramSubmitComment,
  banDetector: detectInstagramBanSignals,
});
