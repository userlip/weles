/**
 * The last-resort click, for an element an ordinary human click cannot
 * reach: a shadow-root vote button, a control inside a child frame, then
 * the page itself, first through the browser's own click and only then by
 * an untrusted script click. Each place that could not be asked says why
 * in the step's log; nothing found answers no-element-found.
 */

import type { Frame, Page } from 'playwright';
import { humanClickLocator } from '../../../human/mouse.js';
import type { WSession } from '../../wsession.js';

type Wanted = { selector?: string; wanted?: string };

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs in a document: every element matching `css`, shadow roots included. */
function frameSearch({ selector, wanted }: Wanted): string | null {
  const all = (root: Document | ShadowRoot, css: string): Element[] => {
    let found = Array.from(root.querySelectorAll(css));
    for (const el of Array.from(root.querySelectorAll('*')))
      if (el.shadowRoot) found = found.concat(all(el.shadowRoot, css));
    return found;
  };
  // A control the click toggled off is put back: this action checks, it never
  // unchecks. Whether the click toggled anything is read from the control.
  const fire = (el: Element) => {
    const wasChecked = el instanceof HTMLInputElement && el.checked;
    (el as HTMLElement).click();
    if (el instanceof HTMLInputElement && wasChecked && !el.checked) {
      el.checked = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  if (selector) {
    const [el] = all(document, selector);
    if (el) {
      fire(el);
      return `clicked-frame-untrusted: ${selector}`;
    }
  }
  if (!wanted) return null;
  for (const el of all(
    document,
    'label,button,a,[role="button"],[role="checkbox"],[role="radio"],input[type="checkbox"],input[type="radio"]',
  )) {
    const label = [
      el.textContent,
      el.getAttribute('aria-label'),
      el.getAttribute('name'),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!label.includes(wanted)) continue;
    fire(el);
    const forId = el.getAttribute('for');
    const input = forId ? document.getElementById(forId) : null;
    if (input) fire(input);
    return `clicked-frame-untrusted: ${label.trim()}`;
  }
  return null;
}

/** Runs in the page: an element by selector, else a control whose text holds the wanted words. */
function pageSearch({ selector, wanted }: Wanted): string | null {
  const all = (root: Document | ShadowRoot, css: string): Element[] => {
    let found = Array.from(root.querySelectorAll(css));
    for (const el of Array.from(root.querySelectorAll('*')))
      if (el.shadowRoot) found = found.concat(all(el.shadowRoot, css));
    return found;
  };
  if (selector) {
    const [el] = all(document, selector);
    if (el) {
      (el as HTMLElement).click();
      return `clicked-untrusted: ${selector}`;
    }
  }
  if (!wanted) return null;
  for (const el of all(
    document,
    'button,a,[role="button"],[class*="vote"],[class*="like"],[class*="star"],[class*="follow"]',
  )) {
    const label = [el.textContent, el.getAttribute('aria-label')]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!label.includes(wanted)) continue;
    (el as HTMLElement).click();
    return `clicked-untrusted: ${label.trim()}`;
  }
  return null;
}

/** Runs in the page: the shadow-root vote buttons a text naming a vote asks for. */
function shadowVote(wanted: string | null): string | null {
  if (!wanted) return null;
  const buttons: HTMLElement[] = [];
  const collect = (root: Document | ShadowRoot) => {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (!el.shadowRoot) continue;
      buttons.push(
        ...Array.from(
          el.shadowRoot.querySelectorAll<HTMLElement>(
            '[data-post-click-location] button',
          ),
        ),
      );
      collect(el.shadowRoot);
    }
  };
  collect(document);
  // The vote control lists upvote before downvote.
  const [upvote, downvote] = buttons;
  if (wanted.includes('upvote') && upvote) {
    upvote.click();
    return 'clicked upvote (shadow)';
  }
  if (wanted.includes('downvote') && downvote) {
    downvote.click();
    return 'clicked downvote (shadow)';
  }
  return null;
}

/** A trusted click in `frame` by selector, then by text; a frame that refuses is logged. */
async function clickInFrame(
  page: Page,
  frame: Frame,
  selector: string | undefined,
  text: string | undefined,
): Promise<string | null> {
  if (selector) {
    try {
      const loc = frame.locator(selector).first();
      if (await loc.count()) {
        await loc.click();
        return `clicked frame: ${selector}`;
      }
    } catch (error) {
      console.log(
        `[jsClick] frame ${frame.url()} selector ${selector}: ${causeOf(error)}`,
      );
    }
  }
  if (text) {
    try {
      const loc = frame.getByText(new RegExp(text, 'i')).first();
      if ((await loc.count()) && (await loc.isVisible())) {
        await humanClickLocator(page, loc);
        return `clicked frame text: ${text}`;
      }
    } catch (error) {
      console.log(
        `[jsClick] frame ${frame.url()} text ${text}: ${causeOf(error)}`,
      );
    }
  }
  return frame.evaluate(frameSearch, {
    selector,
    wanted: text?.toLowerCase(),
  });
}

/** A trusted click in the page by selector, then a button named by text; a refusal is logged. */
async function clickInPage(
  page: Page,
  selector: string | undefined,
  text: string | undefined,
): Promise<string | null> {
  if (selector) {
    try {
      const loc = page.locator(selector).first();
      if (await loc.count()) {
        await loc.click();
        return `clicked: ${selector}`;
      }
    } catch (error) {
      console.log(`[jsClick] page selector ${selector}: ${causeOf(error)}`);
    }
  }
  if (text) {
    try {
      const loc = page
        .getByRole('button', { name: new RegExp(text, 'i') })
        .first();
      if (await loc.count()) {
        await loc.click();
        return `clicked text: ${text}`;
      }
    } catch (error) {
      console.log(`[jsClick] page text ${text}: ${causeOf(error)}`);
    }
  }
  return page.evaluate(pageSearch, {
    selector,
    wanted: text?.toLowerCase(),
  });
}

export async function wsJsClick(
  s: WSession,
  selector?: string,
  text?: string,
): Promise<string> {
  const label = text ? text : selector;
  return s.runStep(`jsClick_${label}`, async () => {
    const page: Page = s.page;
    const wanted = text ? text.toLowerCase() : null;
    const voted = await page.evaluate(shadowVote, wanted);
    if (voted) return voted;
    const main = page.mainFrame();
    for (const frame of page.frames()) {
      if (frame === main) continue;
      const hit = await clickInFrame(page, frame, selector, text);
      if (hit) return hit;
    }
    const hit = await clickInPage(page, selector, text);
    return hit ? hit : 'no-element-found';
  });
}
