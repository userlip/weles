// Comment on a TikTok video in the account character's voice, through the
// shared action runner. The video is the first one the For You feed leads
// to (../../rail.mjs videoPost); the text is written about its caption and
// posted under that same video.
import { runAction } from '../../../_shared/action-runner.mjs';
import { tiktokSubmitComment } from '../../submit.mjs';
import { TIKTOK_ORIGIN, videoPost } from '../../rail.mjs';
import { detectTikTokBanSignals } from '../../../../../dist/platforms/tiktok/ban_signals.js';

await runAction({
  platform: 'tiktok',
  action: 'organic_comment',
  feedUrl: `${TIKTOK_ORIGIN}/foryou`,
  surfaceLabel: 'tiktok fyp',
  pickPost: videoPost,
  submitComment: tiktokSubmitComment,
  banDetector: detectTikTokBanSignals,
});
