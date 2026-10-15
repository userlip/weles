import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';

// Discord's message composer: a Slate editor with role="textbox".
const COMPOSER =
  'div[role="textbox"][aria-label^="Message"], div[data-slate-editor="true"][role="textbox"]';

/**
 * The conversation a message in this channel joins: the newest message the
 * channel shows. A channel with no message yet has no post to answer, and
 * the message is written for the channel alone.
 */
export async function discordNewestMessage(s) {
  await pageSettled(s.page);
  const newest = s.page
    .locator('li[id^="chat-messages-"] [id^="message-content-"]')
    .last();
  if (!(await newest.count())) return { url: s.page.url() };
  return { postTitle: await newest.innerText(), url: s.page.url() };
}

/** Send `text` in the channel; it counts once Discord clears the composer. */
export async function discordSubmitMessage(s, text) {
  const composer = s.page.locator(COMPOSER).filter({ visible: true }).first();
  await composer.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composer);
  await humanType(s.page, text);
  // Enter sends: Discord has no separate send button.
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(
    (selector) => {
      const field = document.querySelector(selector);
      return !field || !field.textContent.trim();
    },
    COMPOSER,
    { polling: 'raf' },
  );
}
