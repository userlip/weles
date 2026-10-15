// Post a comment on the Product Hunt launch the caller names, through the
// shared action runner: the account's fresh jar (or the sign-in through X
// when it is stale or the gate finds it signed out), the signed-in gate on
// the launch page, the verdict and its record are the runner's.
//
// Env: PRODUCTHUNT_URL (required) the launch the comment is posted on;
// PH_COMMENT (required) the comment, published under the account's name.
//
// The launch's comment editor is a TipTap contenteditable typed into with
// real key events; its post control is found by the vision model. The
// comment counts as posted only when its text shows outside every editor.
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { detectProductHuntBanSignals } from '../../../dist/platforms/producthunt/ban_signals.js';
import { runAction } from '../_shared/action-runner.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { textShownOutsideEditors } from '../_shared/page/shows.mjs';
import { loginViaTwitter } from './_session.mjs';

const TARGET_URL = statedText(['PRODUCTHUNT_URL'], 'the Product Hunt launch page the comment is posted on');
const COMMENT_TEXT = statedText(['PH_COMMENT'], 'the comment text to publish');

await runAction({
  platform: 'producthunt',
  action: 'comment',
  feedUrl: TARGET_URL,
  banDetector: detectProductHuntBanSignals,
  inlineRelogin: async (s, acct) => {
    await loginViaTwitter(s, acct);
    return { ok: true };
  },
  act: async (s) => {
    const editor = s.page.locator('[contenteditable="true"][role="textbox"].tiptap').first();
    await editor.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, editor);
    await humanType(s.page, COMMENT_TEXT);
    await clickDescribed(s.page, 'the button that posts the comment typed in the comment editor');
    await pageSettled(s.page);
    if (!(await textShownOutsideEditors(s.page, COMMENT_TEXT)))
      throw new Error(`PRODUCTHUNT_COMMENT_UNCONFIRMED: the comment shows nowhere outside the editor at ${s.page.url()}`);
    return `commented on ${TARGET_URL}`;
  },
});
