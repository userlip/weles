// What a model sees on the page, for the decisions a trajectory used to make
// with a list of the words a site prints.
//
// A word list answers for one language and one copy of a page: Ads Manager in
// Polish, a renamed button or a reworded banner and the list is silently
// wrong. These two questions go to the vision model through Jeden's Brama
// route instead (`src/vision/analyze.ts`): whether the settled page shows what
// the caller describes, and where the control the caller describes is, which
// is then clicked the way a person clicks. A control the model cannot find is
// refused with the description and the page it was looked for on.

import {
  checkPage,
  findClickTarget,
} from '../../../../../dist/vision/analyze.js';
import { humanClick } from '../../../../../dist/human/mouse.js';
import { pageSettled } from '../settled.mjs';

/** Whether the settled page shows what `question` describes (a yes/no question). */
export async function pageShows(page, question) {
  await pageSettled(page);
  return checkPage(page, question);
}

/**
 * Clicks the control `description` names on the settled page and waits for the
 * page to settle again. Resolves the point clicked; throws naming the
 * description and the page when the model finds no such control.
 */
export async function clickDescribed(page, description) {
  await pageSettled(page);
  const target = await findClickTarget(page, description);
  if (!target) {
    throw new Error(
      `the vision model found no control matching "${description}" on ${page.url()}`,
    );
  }
  await humanClick(page, target.x, target.y);
  await pageSettled(page);
  return target;
}
