import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';

const POST_IDENTITY = ['data-urn', 'data-id'];
const postNamed = (page, id) =>
  page
    .locator(POST_IDENTITY.map((name) => `[${name}="${id}"]`).join(', '))
    .first();

/**
 * The first post the page shows (the one whose React Like control comes
 * first), pinned by LinkedIn's own identifier for it, with its text. A page
 * without a post, a post LinkedIn does not identify, or one without text is
 * refused.
 */
export async function linkedinFirstPost(s) {
  await pageSettled(s.page);
  const like = s.page.locator('button[aria-label*="React Like" i]').first();
  if (!(await like.count()))
    throw new Error(
      `LINKEDIN_NO_POST: ${s.page.url()} shows no post to answer`,
    );
  const pinned = await like.evaluate((button, names) => {
    const selector = names.map((name) => `[${name}]`).join(', ');
    const post = button.closest(selector);
    if (!post) return null;
    const name = names.find((candidate) => post.hasAttribute(candidate));
    return { id: post.getAttribute(name) };
  }, POST_IDENTITY);
  if (!pinned)
    throw new Error(
      `LINKEDIN_POST_UNIDENTIFIED: the first post on ${s.page.url()} carries no ${POST_IDENTITY.join(' or ')}`,
    );
  const text = postNamed(s.page, pinned.id)
    .locator('.feed-shared-update-v2__description, .update-components-text')
    .first();
  if (!(await text.count()))
    throw new Error(
      `LINKEDIN_NO_POST_TEXT: post ${pinned.id} carries no text to answer`,
    );
  return {
    postTitle: await text.innerText(),
    url: s.page.url(),
    id: pinned.id,
  };
}

/**
 * Comment on the post the run picked (linkedinFirstPost), found again by its
 * identifier; the comment counts once LinkedIn clears its editor.
 */
export async function linkedinSubmitComment(s, text, post) {
  const pinned = postNamed(s.page, post.id);
  if (!(await pinned.count()))
    throw new Error(
      `LINKEDIN_POST_GONE: post ${post.id}, which the comment was written for, is no longer on ${s.page.url()}`,
    );
  const commentBtn = pinned
    .locator(
      'button[aria-label="Comment"], button[aria-label*="comment" i]:not([aria-label*="React" i])',
    )
    .filter({ visible: true })
    .first();
  await commentBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, commentBtn);
  // The comment editor can attach outside the post wrapper, by layout.
  const editor = s.page
    .locator(
      '[data-testid*="editor"][contenteditable="true"], [data-testid*="composer"][contenteditable="true"], div[role="textbox"][contenteditable="true"], div.ql-editor[contenteditable="true"]',
    )
    .filter({ visible: true })
    .first();
  await editor.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, editor);
  await humanType(s.page, text);
  const postBtn = s.page
    .locator('button.comments-comment-box__submit-button:not([disabled])')
    .filter({ visible: true })
    .first();
  await postBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, postBtn);
  await s.page.waitForFunction(() => {
    const e = document.querySelector(
      'div[role="textbox"][contenteditable="true"]',
    );
    return !e || !e.textContent.trim();
  });
}

export async function linkedinSubmitPost(s, text) {
  await s.goto('https://www.linkedin.com/feed/');
  await pageSettled(s.page);
  // Open the feed's post composer through its accessible label.
  const startPost = s.page
    .locator('button.share-box-feed-entry__trigger')
    .filter({ visible: true })
    .first();
  await startPost.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, startPost);
  // The composer migrated off Quill (.ql-editor / div[role="textbox"]).
  // Match a wider set of editor shapes — data-testid is the stable LinkedIn
  // 2026 attribute; legacy + bare contenteditable kept as fall-throughs.
  const editor = s.page
    .locator(
      '[data-testid*="editor"][contenteditable="true"], [data-testid*="composer"][contenteditable="true"], div[role="textbox"][contenteditable="true"], div.ql-editor[contenteditable="true"], [contenteditable="true"]:not([role="combobox"]):not([role="textbox"])',
    )
    .filter({ visible: true })
    .first();
  await editor.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, editor);
  await humanType(s.page, text);
  const postBtn = s.page
    .locator(
      'button.share-actions__primary-action:not([disabled]), [data-testid*="post"][role="button"]:not([disabled])',
    )
    .filter({ visible: true })
    .first();
  await postBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, postBtn);
  await s.page.waitForFunction(
    () =>
      !document.querySelector(
        'div[role="dialog"] div.ql-editor[contenteditable="true"]',
      ),
  );
}
