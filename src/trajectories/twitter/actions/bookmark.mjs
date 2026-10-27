// Bookmark an X post through the shared action runner: the account's fresh
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
  'the X post to bookmark',
  'TWITTER_BOOKMARK_TARGET_REQUIRED',
);

await runAction({
  platform: 'twitter',
  action: 'bookmark',
  banDetector: detectTwitterBanSignals,
  act: async (s) => {
    const post = await statusPost(s.page, TARGET_URL);
    const kept = await takeOnce(
      s.page,
      post.locator('[data-testid="bookmark"]'),
      post.locator('[data-testid="removeBookmark"]'),
      'bookmark',
    );
    return kept
      ? `${TARGET_URL} is already bookmarked`
      : `bookmarked ${TARGET_URL}`;
  },
});
