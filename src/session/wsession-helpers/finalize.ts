/**
 * WSession click, fill and persistence helpers. Closing a session lives in
 * ./close/session_close.ts.
 */

import type { Frame, Locator } from 'playwright';
import { assertNonCredentialInput } from '../../utils/capability.js';
import { humanClick, humanClickLocator } from '../../human/mouse.js';
import { humanFill, humanType } from '../../human/keyboard.js';
import {
  findClickTarget,
  type ScreenshottablePage,
} from '../../vision/analyze.js';
import type { WSession } from '../wsession.js';
import {
  clickObservedControl,
  clickSelectorControl,
  describeInputTarget,
} from '../observation/controls.js';
import { assertFocusedLiteralInput } from '../wsession/page-actions.js';

export {
  CREDENTIAL_FIELD_ABSENT,
  wsFillCredential,
  wsFillIdentity,
} from './close/credential_fill.js';
export { wsCheckEmail, wsSaveAccount } from './close/account_record.js';
export { wsClose } from './close/session_close.js';

const asV = (p: any) => p as unknown as ScreenshottablePage;

export function childFrames(s: WSession, allowedOrigin?: string): Frame[] {
  try {
    const frames: Frame[] = s.page.frames?.() ?? [];
    const mainFrame = s.page.mainFrame?.();
    return frames.filter((frame) => {
      if (frame === mainFrame) return false;
      if (!allowedOrigin) return true;
      try {
        return new URL(frame.url()).origin === allowedOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export async function firstVisible(loc: any): Promise<any | null> {
  try {
    const first = loc?.first?.() ?? loc;
    let count = 1;
    if (typeof loc?.count === 'function')
      count = await loc.count().catch(() => 0);
    if (count > 0 && (await first.isVisible())) return first;
  } catch {}
  return null;
}

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
  if (!['https:', 'http:'].includes(pageUrl.protocol))
    throw new Error('fill requires an HTTP(S) origin');
  const literal = assertNonCredentialInput(value, target);
  return s.runStep(`fill_${target}`, () =>
    fillPage(s, target, literal, pageUrl.origin),
  );
}
