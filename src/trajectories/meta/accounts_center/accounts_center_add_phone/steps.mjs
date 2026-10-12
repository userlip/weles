// The phone steps: choosing a control by its label, the phone and code fields, and the account chooser.
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
import { USER_DATA_DIR, VERIFY_CODE, VERIFY_PHONE } from './settings.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { sanitize } from './page.mjs';

export async function clickFirst(
  page,
  label,
  allow,
  deny = /delete|remove|usuń|anuluj|cancel/i,
) {
  const target = await page
    .evaluate(
      ({ allowSource, allowFlags, denySource, denyFlags }) => {
        const allowRe = new RegExp(allowSource, allowFlags);
        const denyRe = new RegExp(denySource, denyFlags);
        const textOf = (el) =>
          (
            el.innerText ||
            el.textContent ||
            el.getAttribute('aria-label') ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        const visible = (el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const nodes = Array.from(
          document.querySelectorAll(
            'button, [role="button"], a, [role="menuitem"]',
          ),
        )
          .filter(visible)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              text: textOf(el),
              disabled:
                el.disabled === true ||
                el.getAttribute('aria-disabled') === 'true',
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              area: rect.width * rect.height,
            };
          })
          .filter(
            (item) =>
              item.text &&
              !item.disabled &&
              allowRe.test(item.text) &&
              !denyRe.test(item.text),
          )
          .sort((a, b) => a.area - b.area);
        return nodes[0] || null;
      },
      {
        allowSource: allow.source,
        allowFlags: allow.flags,
        denySource: deny.source,
        denyFlags: deny.flags,
      },
    )
    .catch(() => null);
  if (!target) return null;
  await page.mouse.click(target.x, target.y);
  await pageSettled(page);
  console.log(
    JSON.stringify({
      stage: 'clicked',
      label,
      text: sanitize(target.text),
      x: target.x,
      y: target.y,
    }),
  );
  return target;
}

/** Click the first matching control once the page has settled; null when the page offers none. */
export async function waitAndClickFirst(page, label, allow, deny) {
  await pageSettled(page);
  return clickFirst(page, label, allow, deny);
}

/** The digits of `text`; Meta formats a phone field as it is typed. */
function digits(text) {
  return String(text).replace(/\D/g, '');
}

/** Type `text` into `input` and confirm the field holds it. A click, select
 * or keystroke that failed used to be dropped, and the step logged the field
 * as filled while it held nothing or the old value. */
async function typeInto(page, input, text, stage) {
  await humanClickLocator(page, input);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, text);
  await pageSettled(page);
  const held = await input.inputValue();
  if (!digits(held).endsWith(digits(text)))
    throw new Error(
      `${stage}: the field holds ${digits(held).length} digits, not the ${digits(text).length} typed`,
    );
  console.log(JSON.stringify({ stage, redacted: true }));
  return true;
}

export async function fillPhone(page) {
  const input = await page
    .locator(
      'input[type="tel"], input[placeholder*="phone" i], input[aria-label*="phone" i], input[placeholder*="telefon" i], input[aria-label*="telefon" i], input[type="text"]',
    )
    .filter({ visible: true })
    .last();
  if (!(await input.isVisible())) return false;
  return typeInto(page, input, VERIFY_PHONE, 'filled_phone');
}

export async function fillCode(page) {
  if (!VERIFY_CODE) return false;
  const input = page.locator('input').filter({ visible: true }).last();
  if (!(await input.isVisible())) return false;
  return typeInto(page, input, VERIFY_CODE, 'filled_code');
}

export async function selectPhoneAssociationAccount(page) {
  const target = await page
    .evaluate(() => {
      const textOf = (el) =>
        (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const candidates = Array.from(
        document.querySelectorAll(
          'button, [role="button"], [role="group"], label, div',
        ),
      )
        .filter(visible)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            text: textOf(el),
            role: el.getAttribute('role') || el.tagName.toLowerCase(),
            // A grouped account row is preferred over the parts inside it.
            group: el.matches('[role="group"]'),
            disabled:
              el.disabled === true ||
              el.getAttribute('aria-disabled') === 'true',
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
            area: rect.width * rect.height,
          };
        })
        .filter(
          (item) =>
            /Wisent Wisent Facebook/i.test(item.text) &&
            item.y > 500 &&
            !item.disabled,
        )
        .sort((a, b) => Number(b.group) - Number(a.group) || a.area - b.area);
      return candidates[0] || null;
    })
    .catch(() => null);
  if (!target) return null;
  await page.mouse.click(target.x, target.y);
  await pageSettled(page);
  console.log(
    JSON.stringify({
      stage: 'clicked',
      label: 'select_phone_association_account',
      text: sanitize(target.text),
      role: target.role,
      x: target.x,
      y: target.y,
    }),
  );
  return target;
}

console.log(
  JSON.stringify(
    {
      stage: 'start',
      userDataDir: USER_DATA_DIR,
      headless: process.env.META_VERIFY_HEADLESS === '1',
    },
    null,
    2,
  ),
);
