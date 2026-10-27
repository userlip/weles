// Two-state controls: a control that takes an action (like, bookmark,
// follow) which the page replaces, once the action is taken, by the control
// that undoes it (unlike, remove bookmark, unfollow).
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { pageSettled } from '../settled.mjs';

/**
 * Take the action of `take` unless `taken` already shows. Answers whether it
 * was taken already. A page showing neither control is refused naming
 * `what`; a click the page does not answer with `taken` leaves the wait to
 * fail.
 */
export async function takeOnce(page, take, taken, what) {
  await pageSettled(page);
  if (await taken.isVisible()) return true;
  if (!(await take.isVisible()))
    throw new Error(`CONTROL_MISSING: ${page.url()} shows no ${what} control`);
  await humanClickLocator(page, take);
  await taken.waitFor({ state: 'visible' });
  return false;
}
