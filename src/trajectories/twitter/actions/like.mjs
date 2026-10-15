// Like an X post through the shared action runner: the account's fresh
// jar, the signed-in gate, the verdict and its record are the runner's.
//
// Env: TARGET_URL (required): the post's status address.
import { detectTwitterBanSignals } from '../../../../dist/platforms/twitter/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { statusPost } from './toggle.mjs';
import { takeOnce } from '../../_shared/page/controls/toggle.mjs';

const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the X post to like',
  'TWITTER_LIKE_TARGET_REQUIRED',
);

await runAction({
  platform: 'twitter',
  action: 'like',
  banDetector: detectTwitterBanSignals,
  act: async (s) => {
    const post = await statusPost(s.page, TARGET_URL);
    const liked = await takeOnce(
      s.page,
      post.locator('[data-testid="like"]'),
      post.locator('[data-testid="unlike"]'),
      'like',
    );
    return liked ? `${TARGET_URL} is already liked` : `liked ${TARGET_URL}`;
  },
});
