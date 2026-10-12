/**
 * WSession click helpers and the re-exports of the fill, account and close
 * helpers in ./close/.
 */

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
import { childFrames, firstVisible } from './close/page_fill.js';

export {
  CREDENTIAL_FIELD_ABSENT,
  wsFillCredential,
  wsFillIdentity,
} from './close/credential_fill.js';
export { wsCheckEmail, wsSaveAccount } from './close/account_record.js';
export { wsClose } from './close/session_close.js';
export { wsFill } from './close/page_fill.js';

const asV = (p: any) => p as unknown as ScreenshottablePage;

// G17: per-run layout — recordings/<run_uuid>/<label>/.
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
    const tryLoc = async (
      loc: any,
      descPrefix: string,
    ): Promise<string | null> => {
      try {
        if ((await loc.count?.()) > 0 && (await loc.first().isVisible())) {
          await humanClickLocator(s.page, loc.first());
          return `clicked ${descPrefix}${target}`;
        }
      } catch {}
      return null;
    };
    const tEsc = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reExact = new RegExp(`^\\s*${tEsc}\\s*$`, 'i');
    const reLoose = new RegExp(tEsc, 'i');
    for (const frame of childFrames(s)) {
      for (const role of ['button', 'link', 'checkbox', 'radio'] as const) {
        try {
          const r = await tryLoc(
            frame.getByRole(role, { name: reExact }),
            `frame ${role}: `,
          );
          if (r) return r;
        } catch {}
      }
      for (const role of ['button', 'link', 'radio'] as const) {
        try {
          const r = await tryLoc(
            frame.getByRole(role, { name: reLoose }),
            `frame ${role}: `,
          );
          if (r) return r;
        } catch {}
      }
      if (/\b(submit|send)\b/i.test(target)) {
        const submit = await firstVisible(
          frame.locator?.(
            'input[type="submit"], button[type="submit"], button, [role="button"]',
          ),
        );
        if (submit) {
          await humanClickLocator(s.page, submit);
          return `clicked frame submit: ${target}`;
        }
      }
    }
    for (const role of ['button', 'link', 'checkbox'] as const) {
      try {
        const r = await tryLoc(
          s.page.getByRole(role, { name: reExact }),
          `${role}: `,
        );
        if (r) return r;
      } catch {}
    }
    for (const role of ['button', 'link'] as const) {
      try {
        const r = await tryLoc(
          s.page.getByRole(role, { name: reLoose }),
          `${role}: `,
        );
        if (r) return r;
      } catch {}
    }
    const marker = `weles-click-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const c = await s.page
      .evaluate(
        // Finds the control whose text or label is the target (or holds it),
        // across shadow roots, and marks it for a trusted click. The control
        // is described by its whole text, never a cut of it.
        ({ wanted, mark }: { wanted: string; mark: string }) => {
          const all = (root: any, selector: string): any[] => {
            let found: any[] = Array.from(root.querySelectorAll(selector));
            root.querySelectorAll('*').forEach((el: any) => {
              if (el.shadowRoot)
                found = found.concat(all(el.shadowRoot, selector));
            });
            return found;
          };
          const [shadowUpvote] = all(
            document,
            '[data-post-click-location] button',
          );
          if (wanted.includes('upvote') && shadowUpvote) {
            shadowUpvote.setAttribute('data-weles-click', mark);
            return { desc: 'upvote (shadow)' };
          }
          const words = (el: any) =>
            [el.textContent.trim(), el.getAttribute('aria-label')?.trim()]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .trim();
          const controls = all(
            document,
            'button,a,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="option"],[data-e2e],label,input[type="checkbox"],[role="checkbox"]',
          ).filter((el) => {
            const box = el.getBoundingClientRect();
            return Boolean(box.width && box.height) && el.offsetParent !== null;
          });
          const exact = controls.find((el) => words(el) === wanted);
          const hit =
            exact ?? controls.find((el) => words(el).includes(wanted));
          if (!hit) return null;
          (hit.querySelector('input[type="checkbox"]') ?? hit).setAttribute(
            'data-weles-click',
            mark,
          );
          return { desc: `${exact ? 'exact' : 'partial'}:${words(hit)}` };
        },
        { wanted: target.toLowerCase().trim(), mark: marker },
      )
      .catch((error) => {
        // A page that cannot be searched is not a page without the control;
        // clicking by vision then would hide why the text search failed.
        throw new Error(`could not search the page for ${target}: ${error}`);
      });
    if (c) {
      const loc = s.page.locator(`[data-weles-click="${marker}"]`).first();
      try {
        await humanClickLocator(s.page, loc);
      } finally {
        await s.page
          .evaluate(
            `(()=>{document.querySelectorAll('[data-weles-click=${JSON.stringify(marker)}]').forEach(e=>e.removeAttribute('data-weles-click'))})()`,
          )
          .catch(() => {});
      }
      return `clicked ${(c as any).desc ?? target}`;
    }
    const coords = await findClickTarget(asV(s.page), target);
    if (coords) {
      await humanClick(s.page, coords.x, coords.y);
      return `clicked ${target} (vision)`;
    }
    return 'no-target-found';
  });
}
