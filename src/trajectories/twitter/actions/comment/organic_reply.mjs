// Reply on the X home feed in the account character's voice, through the
// shared action runner. The reply answers the first post the feed shows,
// and the text is written about that same post.
import { runAction } from '../../../_shared/action-runner.mjs';
import { twitterFirstPost, twitterSubmitReply } from '../../submit.mjs';
import { detectTwitterBanSignals } from '../../../../../dist/platforms/twitter/ban_signals.js';

await runAction({
  platform: 'twitter',
  action: 'organic_reply',
  feedUrl: 'https://x.com/home',
  surfaceLabel: 'x.com feed',
  pickPost: twitterFirstPost,
  submitComment: twitterSubmitReply,
  banDetector: detectTwitterBanSignals,
});
