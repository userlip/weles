// What a model sees on the page, for the decisions a trajectory used to make
// with a list of the words a site prints.
//
// A word list answers for one language and one copy of a page: Ads Manager in
// Polish, a renamed button or a reworded banner and the list is silently
// wrong. These questions go to the vision model through Jeden's Brama route
// instead (`src/vision/analyze.ts`): whether the settled page shows what the
// caller describes, and where the control or field the caller describes is,
// which is then clicked - and typed into - the way a person does it. A
// control the model cannot find, and a field that does not hold what was
// typed, are refused with the description and the page.

import {
  askPage,
  checkPage,
  findClickTarget,
} from '../../../../../dist/vision/analyze.js';
import { humanClick } from '../../../../../dist/human/mouse.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
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

/**
 * Clicks the control `description` names when the settled page shows one, and
 * says whether it did; a page without it is an answer, not a failure.
 */
export async function clickOffered(page, description) {
  if (!(await pageShows(page, `Does the page show ${description}?`)))
    return false;
  await clickDescribed(page, description);
  return true;
}

/**
 * The dollar amount the settled page shows for `what` (an account balance, a
 * remaining credit), as the vision model reads it; null when the model says
 * the page shows none.
 */
export async function shownAmount(page, what) {
  await pageSettled(page);
  const answer = await askPage(
    page,
    `What ${what} does the page show, in US dollars? Answer with the number alone, or NONE when the page shows none.`,
  );
  const found = answer.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return found ? Number(found.shift()) : null;
}

/**
 * Types `value` into the field `description` names, replacing what it held,
 * and confirms the focused field then holds exactly `value`.
 */
export async function fillDescribed(page, description, value) {
  await clickDescribed(page, description);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, String(value));
  await pageSettled(page);
  const held = await page.evaluate(() => {
    const field = document.activeElement;
    return typeof field.value === 'string' ? field.value : field.innerText;
  });
  if (held.trim() !== String(value).trim()) {
    throw new Error(
      `the field "${description}" on ${page.url()} holds ${JSON.stringify(held)} after ${JSON.stringify(String(value))} was typed`,
    );
  }
}
