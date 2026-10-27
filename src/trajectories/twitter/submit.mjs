import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';

/** The first post the page shows: the one a reply on this page answers. */
function firstPost(page) {
  return page
    .locator('article[data-testid="tweet"]')
    .filter({ visible: true })
    .first();
}

/**
 * The text of the first post the page shows, which twitterSubmitReply
 * answers; a first post without text is refused.
 */
export async function twitterFirstPost(s) {
  const post = firstPost(s.page);
  await post.waitFor({ state: 'visible' });
  const text = post.locator('[data-testid="tweetText"]').first();
  if (!(await text.count()))
    throw new Error(
      `the first post on ${s.page.url()} carries no text to answer`,
    );
  return { postTitle: await text.innerText() };
}

// Click the first post's Reply button → fill composer → submit. Each step is
// a single deterministic Playwright locator path with state-flip verification.
export async function twitterSubmitReply(s, text) {
  const replyBtn = firstPost(s.page).locator('[data-testid="reply"]').first();
  await replyBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, replyBtn);
  // Composer textbox — Twitter uses a contenteditable div with role="textbox"
  // and data-testid="tweetTextarea_0" inside the modal/inline composer.
  const composer = s.page
    .locator(
      'div[data-testid^="tweetTextarea_"][role="textbox"], div[role="textbox"][aria-label*="Post text" i], div[role="textbox"][aria-label*="Reply" i]',
    )
    .filter({ visible: true })
    .first();
  await composer.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composer);
  await humanType(s.page, text);
  // Send. Twitter's button data-testid='tweetButton' is enabled once the
  // composer has any text. waitFor visible just to be sure modal animated in.
  const sendBtn = s.page
    .locator(
      '[data-testid="tweetButton"]:not([aria-disabled="true"]), [data-testid="tweetButtonInline"]:not([aria-disabled="true"])',
    )
    .filter({ visible: true })
    .first();
  await sendBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, sendBtn);
  // Composer dismiss confirms send (modal closes / inline shrinks).
  await s.page.waitForFunction(
    () =>
      !document.querySelector(
        'div[data-testid^="tweetTextarea_"][role="textbox"]',
      ) || /\/status\/\d+/.test(location.pathname),
  );
}

// Click the compose-tweet button → fill text → click Post.
export async function twitterSubmitPost(s, text) {
  await s.page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  const composeBtn = s.page
    .locator(
      'a[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"], a[href="/compose/tweet"]',
    )
    .filter({ visible: true })
    .first();
  await composeBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composeBtn);
  const composer = s.page
    .locator(
      'div[data-testid^="tweetTextarea_"][role="textbox"], div[role="textbox"][aria-label*="Post text" i]',
    )
    .filter({ visible: true })
    .first();
  await composer.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composer);
  await humanType(s.page, text);
  const postBtn = s.page
    .locator(
      '[data-testid="tweetButton"]:not([aria-disabled="true"]), [data-testid="tweetButtonInline"]:not([aria-disabled="true"])',
    )
    .filter({ visible: true })
    .first();
  await postBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, postBtn);
  await s.page.waitForFunction(
    () =>
      !document.querySelector(
        'div[data-testid^="tweetTextarea_"][role="textbox"]',
      ),
  );
}
