// Like one Instagram post through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the runner's.
//
// Env: TARGET_URL (required): the post's page (/p/<code> or /reel/<code>);
// the post liked is the caller's, never whichever the feed shows first.
//
// The post's like control is the svg labelled "Like" (in its button), which
// Instagram replaces with one labelled "Unlike" once the like is taken.
import { detectInstagramBanSignals } from '../../../../dist/platforms/instagram/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { takeOnce } from '../../_shared/page/controls/toggle.mjs';

const TARGET_URL = statedText(['TARGET_URL'], 'the Instagram post to like', 'INSTAGRAM_LIKE_TARGET_REQUIRED');
if (!/^\/(?:p|reel)\/[^/]+/.test(new URL(TARGET_URL).pathname))
  throw new Error(`INSTAGRAM_LIKE_TARGET_NOT_A_POST: ${TARGET_URL} is not an Instagram post address (/p/… or /reel/…)`);

await runAction({
  platform: 'instagram',
  action: 'like',
  banDetector: detectInstagramBanSignals,
  act: async (s) => {
    const liked = await takeOnce(
      s.page,
      s.page.locator('div[role="button"]:has(svg[aria-label="Like"]), svg[aria-label="Like"]').filter({ visible: true }).first(),
      s.page.locator('svg[aria-label="Unlike"]').filter({ visible: true }).first(),
      'like',
    );
    return liked ? `${TARGET_URL} is already liked` : `liked ${TARGET_URL}`;
  },
});
