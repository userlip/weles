// React "Like" to a LinkedIn post through the shared action runner: the
// account's fresh jar, the inline sign-in again when it is stale, the
// signed-in gate, the verdict and its record are the runner's.
//
// Env: TARGET_URL (required): the post's page.
//
// The post's like control is <button aria-label="React Like"> (comment likes
// are labelled differently), which LinkedIn presses once the like is taken.
// A page that shows no post to like is refused.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectLinkedInBanSignals } from '../../../../dist/platforms/linkedin/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { reloginLinkedinInline } from '../../_shared/linkedin/relogin.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the LinkedIn post to like',
  'LINKEDIN_LIKE_TARGET_REQUIRED',
);
const REACT_LIKE = 'button[aria-label*="React Like" i]';

await runAction({
  platform: 'linkedin',
  action: 'like',
  inlineRelogin: reloginLinkedinInline,
  banDetector: detectLinkedInBanSignals,
  act: async (s) => {
    await pageSettled(s.page);
    const liked = s.page.locator(`${REACT_LIKE}[aria-pressed="true"]`).first();
    if (await liked.count()) return `${TARGET_URL} is already liked`;
    const like = s.page.locator(REACT_LIKE).first();
    if (!(await like.count()))
      throw new Error(
        `LINKEDIN_NOTHING_TO_LIKE: ${s.page.url()} shows no post with a like control`,
      );
    await humanClickLocator(s.page, like);
    await liked.waitFor({ state: 'visible' });
    return `liked ${TARGET_URL}`;
  },
});
