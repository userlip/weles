import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';

/**
 * Comment on the video the run picked (rail.mjs videoPost, which opened its
 * own page): a session that is no longer on that video is refused, so the
 * text is never posted under a video it was not written about. A toast
 * covering the rail is closed first; the comment counts once TikTok clears
 * its input.
 */
export async function tiktokSubmitComment(s, text, post) {
  if (new URL(s.page.url()).pathname !== new URL(post.url).pathname)
    throw new Error(
      `TIKTOK_VIDEO_CHANGED: the comment was written for ${post.url}, but the session is at ${s.page.url()}`,
    );
  await pageSettled(s.page);
  const toast = s.page
    .locator('button[aria-label="Close toast"], button.inapp-notif__close')
    .filter({ visible: true })
    .first();
  if (await toast.count()) {
    await humanClickLocator(s.page, toast);
    await pageSettled(s.page);
  }
  const commentIcon = s.page
    .locator(
      '[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"], [data-e2e="feed-comment-icon"]',
    )
    .filter({ visible: true })
    .first();
  // A video page may open with its comment panel already shown.
  if (await commentIcon.count()) {
    await humanClickLocator(s.page, commentIcon);
    await pageSettled(s.page);
  }
  const input = s.page
    .locator(
      '[data-e2e="comment-input"], [data-e2e="comment-text"], div[contenteditable="true"][role="textbox"], div.DraftEditor-editorContainer div[contenteditable="true"]',
    )
    .filter({ visible: true })
    .first();
  await input.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, input);
  await humanType(s.page, text);
  const send = s.page
    .locator(
      '[data-e2e="comment-post"]:not([aria-disabled="true"]), button[data-e2e="comment-post"]',
    )
    .filter({ visible: true })
    .first();
  await send.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, send);
  await s.page.waitForFunction(() => {
    const e = document.querySelector(
      '[data-e2e="comment-input"], div[contenteditable="true"][role="textbox"]',
    );
    return !e || !e.textContent.trim();
  });
}

export async function tiktokSubmitPost() {
  // TikTok's web upload page takes a video file before a caption; this run
  // has none to upload.
  throw new Error(
    'tiktok_post_not_supported: TikTok requires a video upload; this trajectory does not generate one',
  );
}
