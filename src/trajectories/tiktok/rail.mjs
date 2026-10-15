// The action rail beside a TikTok video: like, favourite and the other
// buttons that are switched on for the signed-in account.
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { clickDescribed, pageShows } from '../_shared/page/judged/seen.mjs';

export const TIKTOK_ORIGIN = 'https://www.tiktok.com';

/**
 * Open the first video of a profile or hashtag grid; a video page stays.
 * A grid with no video refuses by the wait failing on its first link.
 */
export async function openVideo(s) {
  if (new URL(s.page.url()).pathname.includes('/video/')) return;
  const firstVideo = s.page.locator('a[href*="/video/"]').first();
  await firstVideo.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, firstVideo);
  await s.page.waitForURL((url) => url.pathname.includes('/video/'));
  await pageSettled(s.page);
}

/**
 * Whether the rail button is on: its aria-pressed when TikTok renders one,
 * otherwise what the page shows of it.
 */
async function railOn(page, button, what) {
  const pressed = button ? await button.getAttribute('aria-pressed') : null;
  if (pressed !== null) return pressed === 'true';
  return pageShows(
    page,
    `Is the ${what} button beside the video shown switched on for this account (filled or highlighted)?`,
  );
}

/**
 * Switch a rail button on. `selector` finds the button by TikTok's own
 * markers on the settled video page; a page that renders the rail without
 * them has the button found by sight, as `what` names it. Answers whether
 * it was on already; a click TikTok does not answer by switching it on
 * throws.
 */
export async function switchRailOn(page, selector, what) {
  await pageSettled(page);
  const marked = page.locator(selector).filter({ visible: true }).first();
  const button = (await marked.count()) ? marked : null;
  if (await railOn(page, button, what)) return true;
  if (button) await humanClickLocator(page, button);
  else await clickDescribed(page, `the ${what} button beside the video`);
  await pageSettled(page);
  if (!(await railOn(page, button, what)))
    throw new Error(
      `TIKTOK_RAIL_UNCHANGED: the ${what} button is not switched on after the click on ${page.url()}`,
    );
  return false;
}
