// old.reddit.com, where Reddit's subscribe and friend controls are plain
// anchors with class-marked state instead of shadow-DOM web components.

export const OLD_REDDIT = 'https://old.reddit.com';

/** The old.reddit.com address of a reddit.com address. */
export function onOldReddit(url) {
  const address = new URL(url);
  if (!/(^|\.)reddit\.com$/.test(address.hostname))
    throw new Error(`${url} is not a Reddit address`);
  return `${OLD_REDDIT}${address.pathname}${address.search}`;
}

/**
 * Turn an old.reddit fancy toggle on. `toggle` is the toggle span's
 * selector; its <a class="option add"> is shown while off and its
 * <a class="option remove active"> once on. Answers whether it was already
 * on; a click Reddit does not flip leaves the wait to fail.
 */
export async function switchOn(page, toggle, click) {
  const on = page.locator(`${toggle} a.option.remove.active`).first();
  if (await on.isVisible()) return true;
  const off = page.locator(`${toggle} a.option.add`).first();
  await off.waitFor({ state: 'visible' });
  await click(page, off);
  await on.waitFor({ state: 'visible' });
  return false;
}
