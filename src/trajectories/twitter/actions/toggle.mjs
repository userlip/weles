// X's two-state controls: a control whose data-testid names the action
// (like, bookmark, <id>-follow) is replaced, once the action is taken, by
// one whose data-testid names its undoing (unlike, removeBookmark,
// <id>-unfollow).
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';

export const X_ORIGIN = 'https://x.com';

/**
 * The post a status address names, among the posts it answers above it and
 * the replies below: the article whose timestamp links to its own id.
 */
export async function statusPost(page, address) {
  const statusId = new URL(address).pathname.match(/\/status\/(?<id>\d+)/)
    ?.groups.id;
  if (!statusId) throw new Error(`${address} is not an X post address`);
  await pageSettled(page);
  const post = page
    .locator('article[data-testid="tweet"]')
    .filter({ has: page.locator(`a[href$="/status/${statusId}"] time`) })
    .first();
  await post.waitFor({ state: 'visible' });
  return post;
}

/**
 * Take the action of `take` unless `taken` already shows. Answers whether
 * it was taken already; a click X does not answer with `taken` leaves the
 * wait to fail.
 */
export async function takeOnce(page, take, taken, what) {
  await pageSettled(page);
  if (await taken.isVisible()) return true;
  if (!(await take.isVisible()))
    throw new Error(`X_CONTROL_MISSING: ${page.url()} shows no ${what} control`);
  await humanClickLocator(page, take);
  await taken.waitFor({ state: 'visible' });
  return false;
}
