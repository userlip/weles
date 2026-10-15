/**
 * WSession click helpers and the re-exports of the fill, account and close
 * helpers in ./close/.
 */

import { randomUUID } from 'node:crypto';
import { humanClick, humanClickLocator } from '../../human/mouse.js';
import {
  findClickTarget,
  type ScreenshottablePage,
} from '../../vision/analyze.js';
import type { WSession } from '../wsession.js';
import {
  clickObservedControl,
  clickSelectorControl,
} from '../observation/controls.js';
import { childFrames } from './close/page_fill.js';

export {
  CREDENTIAL_FIELD_ABSENT,
  wsFillCredential,
  wsFillIdentity,
} from './close/credential_fill.js';
export { wsNewestMail, wsSaveAccount } from './close/account_record.js';
export { wsClose } from './close/session_close.js';
export { wsFill } from './close/page_fill.js';

const asV = (p: any) => p as unknown as ScreenshottablePage;

// The controls a click target is looked for among.
const CONTROLS =
  'button,a,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[data-e2e],label,input[type="checkbox"],[role="checkbox"],input[type="radio"],[role="radio"]';

/** The answer a click gives when no control on the page is the target. */
export const CLICK_TARGET_ABSENT = 'no-target-found';

/**
 * Click the control `target` names: an observed control, a selector, a
 * control whose text is the target (in each child frame, then the page; an
 * exact text before one that holds it), a control whose text or label is or
 * holds the target across shadow roots, or, last, the one the vision model
 * finds. Answers what it clicked, or CLICK_TARGET_ABSENT when no control is
 * the target; a page that cannot be searched throws.
 */
export async function wsClick(s: WSession, target: string): Promise<string> {
  return s.runStep(`click_${target}`, async () => {
    if (typeof target !== 'string' || !target.trim())
      throw new Error(
        '[target_empty] A click requires a non-empty target; no pointer input was sent',
      );
    const observed = await clickObservedControl(s.page, target);
    if (observed !== null) return observed;
    const selected = await clickSelectorControl(s.page, target);
    if (selected !== null) return selected;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const texts = [new RegExp(`^\\s*${escaped}\\s*$`, 'i'), new RegExp(escaped, 'i')];
    for (const root of [...childFrames(s), s.page]) {
      for (const text of texts) {
        const control = root.locator(CONTROLS).filter({ hasText: text, visible: true }).first();
        if (await control.count()) {
          await humanClickLocator(s.page, control);
          return `clicked ${target}`;
        }
      }
    }
    const marker = `weles-click-${randomUUID()}`;
    const found = await s.page.evaluate(
      // Finds the control whose text or label is the target (or holds it),
      // across shadow roots, and marks it for a trusted click. The control
      // is described by its whole text, never a cut of it.
      ({ wanted, mark, selector }: { wanted: string; mark: string; selector: string }) => {
        const all = (root: any): any[] => {
          let hits: any[] = Array.from(root.querySelectorAll(selector));
          root.querySelectorAll('*').forEach((el: any) => {
            if (el.shadowRoot) hits = hits.concat(all(el.shadowRoot));
          });
          return hits;
        };
        const words = (el: any) =>
          [el.textContent.trim(), el.getAttribute('aria-label')?.trim()]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .trim();
        const controls = all(document).filter((el) => {
          const box = el.getBoundingClientRect();
          return Boolean(box.width && box.height) && el.offsetParent !== null;
        });
        const exact = controls.find((el) => words(el) === wanted);
        const hit = exact ? exact : controls.find((el) => words(el).includes(wanted));
        if (!hit) return null;
        const checkbox = hit.querySelector('input[type="checkbox"]');
        (checkbox ? checkbox : hit).setAttribute('data-weles-click', mark);
        return `${exact ? 'exact' : 'partial'}:${words(hit)}`;
      },
      { wanted: target.toLowerCase().trim(), mark: marker, selector: CONTROLS },
    );
    if (found) {
      const marked = s.page.locator(`[data-weles-click="${marker}"]`).first();
      try {
        await humanClickLocator(s.page, marked);
      } finally {
        await s.page.evaluate(
          (mark: string) =>
            document
              .querySelectorAll(`[data-weles-click="${mark}"]`)
              .forEach((el) => el.removeAttribute('data-weles-click')),
          marker,
        );
      }
      return `clicked ${found}`;
    }
    const coords = await findClickTarget(asV(s.page), target);
    if (coords) {
      await humanClick(s.page, coords.x, coords.y);
      return `clicked ${target} (vision)`;
    }
    return CLICK_TARGET_ABSENT;
  });
}
