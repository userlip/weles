// The action rail beside a TikTok video: like, favourite and the other
// buttons that are switched on for the signed-in account.
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { clickDescribed, pageShows } from '../_shared/page/judged/seen.mjs';

export const TIKTOK_ORIGIN = 'https://www.tiktok.com';

const onVideo = (url) => new URL(url).pathname.includes('/video/');

/**
 * Open a video page from where the session is: a video page stays; a page
 * that links videos (a profile, a hashtag, the feed) opens its first one; a
 * page that links only authors (TikTok's immersive For You player) opens
 * the first author's profile and then its first video. A page that links
 * neither is refused.
 */
export async function openVideo(s) {
  if (onVideo(s.page.url())) return;
  await pageSettled(s.page);
  const firstVideo = s.page.locator('a[href*="/video/"]').filter({ visible: true }).first();
  if (!(await firstVideo.count())) {
    const firstAuthor = s.page.locator('a[href*="/@"]').first();
    if (!(await firstAuthor.count()))
      throw new Error(
        `TIKTOK_NO_VIDEO_SOURCE: ${s.page.url()} links no video and no author profile`,
      );
    await s.goto(new URL(await firstAuthor.getAttribute('href'), TIKTOK_ORIGIN).href);
    await pageSettled(s.page);
    if (!(await firstVideo.count()))
      throw new Error(
        `TIKTOK_NO_VIDEO_SOURCE: the author profile ${s.page.url()} links no video`,
      );
  }
  await humanClickLocator(s.page, firstVideo);
  await s.page.waitForURL((url) => url.pathname.includes('/video/'));
  await pageSettled(s.page);
}

/**
 * The video a comment on this page answers, opened by openVideo, with its
 * caption; a video without a caption is refused.
 */
export async function videoPost(s) {
  await openVideo(s);
  const caption = s.page
    .locator('[data-e2e="video-desc"], [data-e2e="browse-video-desc"]')
    .first();
  if (!(await caption.count()))
    throw new Error(`TIKTOK_NO_CAPTION: ${s.page.url()} shows no video caption to answer`);
  return { postTitle: await caption.innerText(), url: s.page.url() };
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
