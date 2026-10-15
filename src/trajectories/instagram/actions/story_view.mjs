// Watch the stories in the account's Instagram story tray, through the
// shared action runner: the account's fresh jar, the signed-in gate, the
// verdict and its record are the runner's.
//
// The tray's first entry opens the stories viewer (/stories/<user>/<id>),
// which plays every story of the tray and closes itself after the last one;
// the viewer leaving /stories/ is Instagram's own statement that the tray
// was shown, so no count of pauses decides how many register as views. A
// feed with no stories in its tray is refused.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectInstagramBanSignals } from '../../../../dist/platforms/instagram/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { urlMatching } from '../../_shared/page/settled.mjs';

const STORIES_ROUTE = '/stories/';

/** Whether `address` is inside Instagram's stories viewer. */
function inStoriesViewer(address) {
  return new URL(address).pathname.startsWith(STORIES_ROUTE);
}

await runAction({
  platform: 'instagram',
  action: 'story_view',
  feedUrl: 'https://www.instagram.com/',
  banDetector: detectInstagramBanSignals,
  act: async (s) => {
    const story = s.page
      .locator(
        `li[role="menuitem"], button[aria-label^="Story by"], div[role="menuitem"]:has(canvas), a[href^="${STORIES_ROUTE}"]`,
      )
      .filter({ visible: true })
      .first();
    if (!(await story.count()))
      throw new Error(
        `INSTAGRAM_NO_STORIES: the story tray at ${s.page.url()} holds no story to watch`,
      );
    await humanClickLocator(s.page, story);
    await urlMatching(s.page, inStoriesViewer);
    await urlMatching(s.page, (address) => !inStoriesViewer(address));
    return 'viewed the story tray';
  },
});
