import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../page/settled.mjs';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function safeGoto(s, url) {
  try {
    await s.goto(url);
  } catch (e) {
    const message = e.message ?? '';
    // An interrupted navigation means another one replaced it; the page that
    // replaced it has to settle before its URL says where it landed.
    if (/ERR_ABORTED|interrupted by another navigation/i.test(message))
      await pageSettled(s.page);
    const current = s.page.url();
    const target = String(url).replace(/\/$/, '');
    if (
      /ERR_ABORTED|interrupted by another navigation/i.test(message) &&
      current.replace(/\/$/, '').startsWith(target)
    )
      return;
    if (/ERR_ABORTED|interrupted by another navigation/i.test(message)) {
      const currentUrl = new URL(current);
      const targetUrl = new URL(url);
      if (
        targetUrl.hostname === 'cloud.umami.is' &&
        currentUrl.hostname === targetUrl.hostname &&
        !currentUrl.pathname.startsWith('/login')
      )
        return;
    }
    throw e;
  }
}

async function bodyText(page) {
  try {
    return await page.evaluate(() => document.body?.innerText || '');
  } catch (error) {
    throw new Error(
      `page body text could not be read from ${page.url()}: ${error.message}`,
      { cause: error },
    );
  }
}

// The page's text once it has settled. A page that settles with less text than
// `minLength` is still answered with what it shows; callers judge its content.
async function waitRendered(page, minLength = 80) {
  await pageSettled(page);
  const text = await bodyText(page);
  if (text.length < minLength)
    console.log(
      `[analytics] page settled with ${text.length} characters of text (${page.url()})`,
    );
  return text;
}

async function clickCardLike(page, name) {
  const loc = page
    .locator(
      'a, button, tr, mat-row, [role="row"], [role="button"], [role="link"], mat-card, .card, .admin-card, .admin-settings-card',
    )
    .filter({ hasText: name })
    .filter({ visible: true })
    .first();
  if (await loc.isVisible().catch(() => false)) {
    await humanClickLocator(page, loc);
    await pageSettled(page);
    return true;
  }
  return false;
}

// The element is visible, so the click is an action that finishes; the ten
// seconds it used to carry only turned a busy page into a failed click, and
// the retry underneath it was that number's own doing.
async function clickLocator(page, loc) {
  if (!(await loc.isVisible().catch(() => false))) return false;
  try {
    await humanClickLocator(page, loc);
  } catch {
    return false;
  }
  await pageSettled(page);
  return true;
}

async function clickDirectLocator(page, loc) {
  const target = loc.filter({ visible: true }).first();
  if (!(await target.isVisible().catch(() => false))) return false;
  const disabled = await target
    .evaluate(
      (node) =>
        node.hasAttribute('disabled') ||
        node.getAttribute('aria-disabled') === 'true' ||
        node.classList.contains('mat-mdc-button-disabled') ||
        node.classList.contains('mat-button-disabled'),
    )
    .catch(() => false);
  if (disabled) return false;
  await target.scrollIntoViewIfNeeded();
  await humanClickLocator(page, target);
  await pageSettled(page);
  return true;
}

async function clickAnyLocator(page, locators, description = '') {
  for (const loc of locators) {
    if (await clickDirectLocator(page, loc).catch(() => false)) return true;
  }
  if (description) throw new Error(`${description} was not clickable`);
  return false;
}

async function clickDomElement(page, selectors, textPattern = null) {
  const pattern = textPattern
    ? { source: textPattern.source, flags: textPattern.flags }
    : null;
  let target = page.locator(selectors.join(',')).filter({ visible: true });
  if (textPattern) target = target.filter({ hasText: textPattern });
  target = target.first();
  const clicked =
    (await target.isVisible().catch(() => false)) &&
    !(await target.isDisabled().catch(() => true)) &&
    (await humanClickLocator(page, target)
      .then(() => true)
      .catch(() => false));
  if (clicked) await pageSettled(page);
  return clicked;
}

async function fillDomInput(page, selectors, value) {
  if (!value) return false;
  const filled = await page
    .evaluate(
      ({ selectors: selectorList, value: inputValue }) => {
        const visible = (node) => {
          const style = window.getComputedStyle(node);
          const box = node.getBoundingClientRect();
          return (
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            box.width > 0 &&
            box.height > 0 &&
            !node.hasAttribute('disabled') &&
            node.getAttribute('aria-disabled') !== 'true'
          );
        };
        const field = selectorList
          .flatMap((selector) =>
            Array.from(document.querySelectorAll(selector)),
          )
          .find((node) => visible(node));
        if (!field) return false;
        field.scrollIntoView({ block: 'center', inline: 'center' });
        field.focus();
        const prototype =
          field instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
        if (descriptor?.set) descriptor.set.call(field, inputValue);
        else field.value = inputValue;
        field.dispatchEvent(
          new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: inputValue,
          }),
        );
        field.dispatchEvent(new Event('change', { bubbles: true }));
        field.blur();
        return true;
      },
      { selectors, value },
    )
    .catch(() => false);
  if (filled) await pageSettled(page);
  return filled;
}

function activeStepPanel(page) {
  return page
    .locator('div[role="tabpanel"]:not([inert]):not([aria-hidden="true"])')
    .filter({ visible: true })
    .first();
}

export {
  escapeRegExp,
  safeGoto,
  bodyText,
  waitRendered,
  clickCardLike,
  clickLocator,
  clickDirectLocator,
  clickAnyLocator,
  clickDomElement,
  fillDomInput,
  activeStepPanel,
};
