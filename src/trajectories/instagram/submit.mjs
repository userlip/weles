import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { shownText } from '../_shared/page/judged/seen.mjs';

const INSTAGRAM_ORIGIN = 'https://www.instagram.com';
const onPost = (url) => /\/(p|reel)\//.test(new URL(url).pathname);

/**
 * The post a comment on this page answers: a post page stays; a grid
 * (explore, a profile, a hashtag) opens its first post. Its caption is read
 * as the page shows it; a post without one has none to answer.
 */
export async function instagramPost(s) {
  if (!onPost(s.page.url())) {
    await pageSettled(s.page);
    const thumb = s.page
      .locator('a[href*="/p/"], a[href*="/reel/"]')
      .filter({ visible: true })
      .first();
    if (!(await thumb.count()))
      throw new Error(`INSTAGRAM_NO_POST: ${s.page.url()} links no post`);
    await s.goto(
      new URL(await thumb.getAttribute('href'), INSTAGRAM_ORIGIN).href,
    );
    await pageSettled(s.page);
  }
  const caption = await shownText(
    s.page,
    'caption of the post, written by its author',
  );
  if (!caption)
    throw new Error(
      `INSTAGRAM_NO_CAPTION: ${s.page.url()} shows no caption to answer`,
    );
  return { postTitle: caption, url: s.page.url() };
}

/**
 * Comment on the post the run picked (instagramPost); a session that is no
 * longer on that post is refused, so the text is never posted under a post
 * it was not written about. The comment counts once Instagram clears its
 * comment box.
 */
export async function instagramSubmitComment(s, text, post) {
  if (new URL(s.page.url()).pathname !== new URL(post.url).pathname)
    throw new Error(
      `INSTAGRAM_POST_CHANGED: the comment was written for ${post.url}, but the session is at ${s.page.url()}`,
    );
  const box = s.page.locator('form textarea').filter({ visible: true }).first();
  await box.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, box);
  await humanType(s.page, text);
  // The focused comment box posts its text on Enter.
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(() => {
    const field = document.querySelector('form textarea');
    return !field || !field.value;
  });
}
