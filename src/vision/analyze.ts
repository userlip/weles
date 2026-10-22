/**
 * Questions about a page, answered by a vision model. An open question is
 * answered in a line of text (`askPage`); a question whose answer is a
 * choice, a point or a list is answered by calling one declared function
 * whose arguments are the answer (`askPageFunction`, `checkPage`,
 * `identifyPage`, `findClickTarget`), so no answer is read by its first word,
 * a regular expression or the first numbers in it.
 */

import type { FunctionTool } from '../agent/model/router-call.js';
import {
  CLICK_AT,
  type Control,
  clickAtTool,
  controlsTool,
  matchingControl,
  notShownTool,
  pageFunction,
  pngSize,
  point,
} from './escalation.js';
import { askedAboutImage, REFUSE, takeScreenshot } from './recorded.js';

/** Minimal page interface — any object that exposes a CDP-compatible screenshot. */
export interface ScreenshottablePage {
  screenshot?(options?: { type?: string; scale?: string }): Promise<Buffer>;
  /** Raw CDP send for pages backed by CDPConnection. */
  send?(method: string, params?: Record<string, any>): Promise<any>;
}

// A model that will not answer an open question says so in the form the
// prompt asks of it: the answer starts with this marker, followed by its
// reason. An answer is never read as a refusal for containing a word such as
// "bypass".
export const REFUSAL_MARKER = 'REFUSED:';

export class VisionRefusedError extends Error {
  question: string;
  answer: string;
  constructor(question: string, answer: string) {
    super(
      `Jeden refused vision query. Question: ${question}. Answer: ${answer}`,
    );
    this.question = question;
    this.answer = answer;
  }
}

export class PageQuestionError extends Error {
  constructor(question: string, cause: string) {
    super(`the page question "${question}" could not be answered: ${cause}`);
    this.name = 'PageQuestionError';
  }
}

/** One open question about `screenshot`, recorded; the model's text. */
export async function askJedenAboutImage(
  screenshot: Buffer,
  question: string,
  tier = 'tier_0_bare',
): Promise<string> {
  return (await askedAboutImage(screenshot, question, tier)).answer;
}

/**
 * Screenshot the page and ask Jeden an open-ended question about it.
 * Raises VisionRefusedError on safety refusal.
 */
export async function askPage(
  page: ScreenshottablePage,
  question: string,
  imageBytes?: Buffer | null,
  tier = 'tier_0_bare',
): Promise<string> {
  const screenshot = imageBytes ?? (await takeScreenshot(page));
  const answer = await askJedenAboutImage(screenshot, question, tier);
  if (answer.trimStart().startsWith(REFUSAL_MARKER)) {
    throw new VisionRefusedError(question, answer);
  }
  return answer;
}

/**
 * Screenshot the page and have the model answer `question` by calling one of
 * `tools`: the function it called and its arguments.
 */
export async function askPageFunction(
  page: ScreenshottablePage,
  question: string,
  tools: readonly FunctionTool[],
  imageBytes?: Buffer | null,
  tier = 'tier_0_bare',
): Promise<{ name: string; args: Record<string, unknown> }> {
  const screenshot = imageBytes ?? (await takeScreenshot(page));
  return askImageFunction(screenshot, question, tools, tier);
}

/**
 * Have the model answer `question` about `image` by calling one of `tools`:
 * the function it called and its arguments. A model that will not answer
 * calls the declared refusal, raised as VisionRefusedError.
 */
export async function askImageFunction(
  image: Buffer,
  question: string,
  tools: readonly FunctionTool[],
  tier: string,
): Promise<{ name: string; args: Record<string, unknown> }> {
  const { answer, functionName } = await askedAboutImage(
    image,
    question,
    tier,
    tools,
  );
  if (functionName === undefined)
    throw new PageQuestionError(question, `no function was called: ${answer}`);
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(answer);
  } catch (parseError) {
    throw new PageQuestionError(
      question,
      `the ${functionName} arguments are not JSON (${String(parseError)}): ${answer}`,
    );
  }
  if (functionName === REFUSE)
    throw new VisionRefusedError(question, String(args.reason));
  return { name: functionName, args };
}

const shownTool = pageFunction(
  'answer',
  'Whether the image shows what the question asks.',
  { shows: { type: 'boolean' } },
);

/** Ask a yes/no question about the page: whether it shows what is asked. */
export async function checkPage(
  page: ScreenshottablePage,
  question: string,
): Promise<boolean> {
  const { args } = await askPageFunction(page, question, [shownTool]);
  if (typeof args.shows !== 'boolean')
    throw new PageQuestionError(
      question,
      `the answer carries no boolean shows: ${JSON.stringify(args)}`,
    );
  return args.shows;
}

/** The kinds of page `identifyPage` tells apart. */
const PAGE_KINDS = [
  'login_page',
  'dashboard',
  'captcha_challenge',
  'error_page',
  'verification_required',
  'signup_page',
  'success_page',
  'loading',
  'blocked',
  'unknown',
];

const pageKindTool = pageFunction('page_kind', 'The kind of page this is.', {
  kind: { type: 'string', enum: PAGE_KINDS },
});

/** The kind of page displayed, one of the declared kinds. */
export async function identifyPage(page: ScreenshottablePage): Promise<string> {
  const question = 'What type of page is this?';
  const { args } = await askPageFunction(page, question, [pageKindTool]);
  if (typeof args.kind !== 'string' || !PAGE_KINDS.includes(args.kind))
    throw new PageQuestionError(
      question,
      `the answer names no declared kind: ${JSON.stringify(args)}`,
    );
  return args.kind;
}

/**
 * Locate a click target via vision with escalation.
 *
 *   tier_0_bare      the point to click, asked of the full screenshot
 *   tier_1_decompose every visible control listed, then the one the
 *                    description names chosen among their labels
 *
 * The screenshot is sent at the size the page rendered it, and the question
 * states that size, so the answer is in the page's own pixels; no resize width
 * or crop fraction is chosen here.
 *
 * Raises VisionRefusedError only if every tier refuses. Returns null when
 * every tier answered and none found the target.
 */
export async function findClickTarget(
  page: ScreenshottablePage,
  description: string,
): Promise<{ x: number; y: number } | null> {
  const full = await takeScreenshot(page);
  const { width, height } = pngSize(full);
  const frame = `The image is ${width}x${height} pixels; answer in those pixels. `;

  const bareQ = `I need to click: ${description}. ${frame}Give the point to click, or say the image does not show it.`;
  let bareRefusal: string | null = null;
  try {
    const { name, args } = await askPageFunction(
      page,
      bareQ,
      [clickAtTool, notShownTool],
      full,
      'tier_0_bare',
    );
    if (name === CLICK_AT) return point(args);
  } catch (e) {
    if (!(e instanceof VisionRefusedError)) throw e;
    console.log('  [vision] tier_0_bare refused, escalating');
    bareRefusal = String(e);
  }

  const decompQ = `List every interactive UI control visible in this image. ${frame}`;
  let listRefusal: string | null = null;
  try {
    const { args } = await askPageFunction(
      page,
      decompQ,
      [controlsTool],
      full,
      'tier_1_decompose',
    );
    if (!Array.isArray(args.controls))
      throw new PageQuestionError(
        decompQ,
        `the controls answer carries no list: ${JSON.stringify(args)}`,
      );
    const match = await matchingControl(
      description,
      args.controls as Control[],
    );
    if (match) return match;
  } catch (e) {
    if (!(e instanceof VisionRefusedError)) throw e;
    console.log('  [vision] tier_1_decompose refused');
    listRefusal = String(e);
  }
  if (bareRefusal !== null && listRefusal !== null) {
    throw new VisionRefusedError(
      description,
      `Both vision tiers refused: ${JSON.stringify([bareRefusal, listRefusal])}`,
    );
  }
  return null;
}
