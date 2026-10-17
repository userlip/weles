/**
 * Typed vision extractors
 *
 * number/text/boolean/click/fill take a page and a description in
 * plain English. No selectors, no regex, no per-site code. Each value is the
 * argument of a function the model calls, or its declared statement that the
 * page does not show it; no answer is read for words such as "none".
 */

import {
  askPageFunction,
  checkPage,
  findClickTarget,
  type ScreenshottablePage,
} from '../../vision/analyze.js';
import { notShownTool, pageFunction } from '../../vision/escalation.js';
import { humanType } from '../../human/keyboard.js';

/** The value `what` names, as the model reads it off the page, or null. */
async function shown(
  page: ScreenshottablePage,
  what: string,
  type: string,
): Promise<unknown> {
  const valueTool = pageFunction('value', `The value of ${what} shown.`, {
    value: { type },
  });
  const { name, args } = await askPageFunction(
    page,
    `What is ${what} shown on this page?`,
    [valueTool, notShownTool],
  );
  return name === valueTool.function.name ? args.value : null;
}

export async function number(page: any, what: string): Promise<number | null> {
  const value = await shown(page as ScreenshottablePage, what, 'number');
  if (value === null || typeof value === 'number') return value;
  throw new Error(`the value of ${what} is not a number: ${String(value)}`);
}

export async function text(page: any, what: string): Promise<string | null> {
  const value = await shown(page as ScreenshottablePage, what, 'string');
  if (value === null || typeof value === 'string') return value;
  throw new Error(`the value of ${what} is not text: ${String(value)}`);
}

export async function boolean(page: any, question: string): Promise<boolean> {
  return checkPage(page as ScreenshottablePage, question);
}

export async function click(
  page: any,
  targetDescription: string,
): Promise<boolean> {
  const target = await findClickTarget(
    page as ScreenshottablePage,
    targetDescription,
  );
  if (!target) return false;
  await page.mouse.click(target.x, target.y);
  return true;
}

export async function fill(
  page: any,
  targetDescription: string,
  value: string,
): Promise<boolean> {
  const target = await findClickTarget(
    page as ScreenshottablePage,
    targetDescription,
  );
  if (!target) return false;
  await page.mouse.click(target.x, target.y);
  await humanType(page, value);
  return true;
}
