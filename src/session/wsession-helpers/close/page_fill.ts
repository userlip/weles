/**
 * Filling a field on a WSession page: the frames a fill may reach, the first
 * visible control a locator names, and the fill itself.
 */

import type { Frame, Locator } from 'playwright';
import { assertNonCredentialInput } from '../../../utils/capability.js';
import { humanClick } from '../../../human/mouse.js';
import { humanFill, humanType } from '../../../human/keyboard.js';
import {
  findClickTarget,
  type ScreenshottablePage,
} from '../../../vision/analyze.js';
import type { WSession } from '../../wsession.js';
import { describeInputTarget } from '../../observation/controls.js';
import { assertFocusedLiteralInput } from '../../wsession/page-actions.js';

const asV = (p: any) => p as unknown as ScreenshottablePage;

// A Playwright page, frame and locator expose frames(), mainFrame(), url()
// and first() as methods; Weles's CDP page, frame and locator expose them as
// getters. Both shapes are read here: calling a getter's value used to throw
// a TypeError that a catch turned into "no frames" and "no match", so a fill
// on a CDP session never searched a field and went straight to a vision
// guess.
function member(owner: any, name: string): any {
  return typeof owner[name] === 'function' ? owner[name]() : owner[name];
}

export function childFrames(s: WSession, allowedOrigin?: string): Frame[] {
  const mainFrame = member(s.page, 'mainFrame');
  return (member(s.page, 'frames') as Frame[]).filter((frame) => {
    if (frame === mainFrame) return false;
    if (!allowedOrigin) return true;
    // A frame without a parsable URL (about:srcdoc) belongs to no origin.
    const url = member(frame, 'url');
    return URL.canParse(url) ? new URL(url).origin === allowedOrigin : false;
  });
}

/**
 * The first visible control `loc` names, or null when none is visible. A
 * locator that cannot be queried (a closed page, a malformed selector) is not
 * one without a match: its error reaches the caller instead of sending the
 * fill or click on to a label, keyword or vision guess.
 */
export async function firstVisible(
  loc: Locator | undefined,
): Promise<Locator | null> {
  if (!loc) return null;
  const first = member(loc, 'first');
  return (await first.isVisible()) ? first : null;
}

export async function fillPage(
  s: WSession,
  target: string,
  value: string,
  allowedOrigin?: string,
  credentialAuthorized = false,
): Promise<string> {
  if (typeof target !== 'string' || !target.trim())
    throw new Error(
      '[target_empty] A fill requires a non-empty target; no input was sent',
    );
  const fill = async (control: Locator) => {
    if (credentialAuthorized) {
      await humanFill(s.page, control, value);
      return;
    }
    const element = await control.elementHandle();
    if (!element)
      throw new Error(
        '[input_target_stale] The field disappeared before literal input',
      );
    try {
      assertNonCredentialInput(
        value,
        await element.evaluate(describeInputTarget),
      );
      await humanFill(s.page, element, value);
    } finally {
      await element.dispose();
    }
  };
  const explicitSelector = target
    .trim()
    .match(/^(?:input|textarea)(?:\[[^\]]+\])+/)?.[0];
  const description = explicitSelector
    ? target.slice(explicitSelector.length)
    : target;
  const kws = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const sels = kws.flatMap((k) =>
    ['input', 'textarea', '[contenteditable]'].flatMap((t) => [
      `${t}[name*="${k}"]`,
      `${t}[placeholder*="${k}" i]`,
      `${t}[aria-label*="${k}" i]`,
    ]),
  );
  if (/\b(email|e-mail)\b/i.test(target)) {
    sels.unshift(
      'input[type="email"], input[name*="email" i], input[autocomplete*="email" i]',
    );
  }
  for (const frame of [...childFrames(s, allowedOrigin), s.page]) {
    if (explicitSelector) {
      const explicit = await firstVisible(frame.locator?.(explicitSelector));
      if (explicit) {
        await fill(explicit);
        return `filled ${explicitSelector}`;
      }
    }
    const label = await firstVisible(
      frame.getByLabel?.(target, { exact: false }),
    );
    if (label) {
      await fill(label);
      return 'filled label';
    }
    for (const selector of sels) {
      const control = await firstVisible(frame.locator?.(selector));
      if (control) {
        await fill(control);
        return `filled ${selector}`;
      }
    }
  }
  const tgt = JSON.stringify(target.toLowerCase());
  const byPlaceholder = await s.page
    .evaluate(
      `(()=>{var t=${tgt};for(var el of document.querySelectorAll('*')){var r=el.getBoundingClientRect();var ph=(el.getAttribute('placeholder')||'').toLowerCase();if(r.width>50&&r.height>10&&r.x>0&&ph&&ph.indexOf(t)>=0)return{x:r.x+r.width/2,y:r.y+r.height/2}}return null})()`,
    )
    .catch((error) => {
      throw new Error(
        `could not search the page for a ${target} placeholder: ${error}`,
      );
    });
  const point = byPlaceholder ?? (await findClickTarget(asV(s.page), target));
  if (!point) return 'no-field-found';
  await humanClick(s.page, point.x, point.y);
  if (!credentialAuthorized) await assertFocusedLiteralInput(s, value);
  // Typing after a failed select-all appends to whatever the field held, so
  // the field would be submitted with a value nobody asked for.
  await s.page.keyboard.press('Meta+a').catch((error) => {
    throw new Error(
      `could not select the existing text of ${target} before typing: ${error}`,
    );
  });
  await humanType(s.page, value);
  return 'filled';
}

export async function wsFill(
  s: WSession,
  target: string,
  value: string,
): Promise<string> {
  const pageUrl = new URL(s.page.url());
  if (!/^https?:$/.test(pageUrl.protocol))
    throw new Error('fill requires an HTTP(S) origin');
  const literal = assertNonCredentialInput(value, target);
  return s.runStep(`fill_${target}`, () =>
    fillPage(s, target, literal, pageUrl.origin),
  );
}
