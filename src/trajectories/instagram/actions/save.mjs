// Save (bookmark) the Instagram post the caller names, through the shared
// action runner: the account's fresh jar, the signed-in gate, the verdict
// and its record are the runner's.
//
// Env: TARGET_URL (required): the post to save.
//
// The post is read from the page's own controls: its Save button flips to
// Remove once saved. A page that shows neither (a profile, a feed) is not a
// post, and nothing on it is saved in its place.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectInstagramBanSignals } from '../../../../dist/platforms/instagram/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';

/** The post's Save control, or its Remove control once saved. */
function postControl(page, label) {
  return page
    .locator(`svg[aria-label="${label}"]`)
    .filter({ visible: true })
    .first();
}

await runAction({
  platform: 'instagram',
  action: 'save',
  feedUrl: () => statedText(['TARGET_URL'], 'the Instagram post to save'),
  banDetector: detectInstagramBanSignals,
  act: async (s) => {
    const save = postControl(s.page, 'Save');
    const saved = postControl(s.page, 'Remove');
    if (!(await save.count())) {
      if (await saved.count()) return 'already saved';
      throw new Error(
        `INSTAGRAM_NOT_A_POST: ${s.page.url()} shows no post Save control; nothing was saved`,
      );
    }
    // The svg takes no pointer events; its button does.
    await humanClickLocator(
      s.page,
      save
        .locator(
          'xpath=ancestor::*[self::button or self::div[@role="button"] or @role="button"][1]',
        )
        .first(),
    );
    await saved.waitFor({ state: 'visible' });
    return 'saved';
  },
});
