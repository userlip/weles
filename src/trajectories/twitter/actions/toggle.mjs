// X's addresses: its origin, and the post a status address names. Its
// two-state controls carry data-testids naming the action (like, bookmark,
// <id>-follow) and, once taken, its undoing (unlike, removeBookmark,
// <id>-unfollow); they are taken through ../../_shared/page/controls/toggle.mjs.
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
