import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../page/settled.mjs';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const withoutTrailingSlash = (url) => String(url).replace(/\/$/, '');

/**
 * Open `url`. A navigation another one replaced (a redirect the page itself
 * starts) is accepted when the settled page is at or under `url`; anywhere
 * else the navigation's own error is thrown.
 */
async function safeGoto(s, url) {
  try {
    await s.goto(url);
  } catch (error) {
    await pageSettled(s.page);
    if (
      !withoutTrailingSlash(s.page.url()).startsWith(withoutTrailingSlash(url))
    )
      throw error;
  }
}

async function bodyText(page) {
  try {
    return await page.evaluate(() => document.body.innerText);
  } catch (error) {
    throw new Error(
      `page body text could not be read from ${page.url()}: ${error.message}`,
      { cause: error },
    );
  }
}

/** The page's text once it has settled; callers judge its content. */
async function waitRendered(page) {
  await pageSettled(page);
  return bodyText(page);
}

async function clickCardLike(page, name) {
  const loc = page
    .locator(
      'a, button, tr, mat-row, [role="row"], [role="button"], [role="link"], mat-card, .card, .admin-card, .admin-settings-card',
    )
    .filter({ hasText: name })
    .filter({ visible: true })
    .first();
  if (!(await loc.isVisible())) return false;
  await humanClickLocator(page, loc);
  await pageSettled(page);
  return true;
}

/** Click `loc` when it is visible; false when it is not. A click that fails throws. */
async function clickLocator(page, loc) {
  if (!(await loc.isVisible())) return false;
  await humanClickLocator(page, loc);
  await pageSettled(page);
  return true;
}

/** Click the first visible, enabled match of `loc`; false when there is none. */
async function clickDirectLocator(page, loc) {
  const target = loc.filter({ visible: true }).first();
  if (!(await target.isVisible())) return false;
  const disabled = await target.evaluate(
    (node) =>
      node.hasAttribute('disabled') ||
      node.getAttribute('aria-disabled') === 'true' ||
      node.classList.contains('mat-mdc-button-disabled') ||
      node.classList.contains('mat-button-disabled'),
  );
  if (disabled) return false;
  await target.scrollIntoViewIfNeeded();
  await humanClickLocator(page, target);
  await pageSettled(page);
  return true;
}

/**
 * Click the first of `locators` that is visible and enabled. With a
 * `description`, none being clickable throws under that name; without one it
 * answers false.
 */
async function clickAnyLocator(page, locators, description) {
  for (const loc of locators) {
    if (await clickDirectLocator(page, loc)) return true;
  }
  if (description) throw new Error(`${description} was not clickable`);
  return false;
}

/** Click the first visible, enabled element `selectors` (and `textPattern`, when given) match. */
async function clickDomElement(page, selectors, textPattern) {
  let target = page.locator(selectors.join(',')).filter({ visible: true });
  if (textPattern) target = target.filter({ hasText: textPattern });
  target = target.first();
  if (!(await target.isVisible()) || (await target.isDisabled())) return false;
  await humanClickLocator(page, target);
  await pageSettled(page);
  return true;
}

/**
 * Type `value` into the first visible, enabled field `selectors` match, the
 * way the framework's own input events expect. False when no such field is
 * shown; a value that is missing is refused.
 */
async function fillDomInput(page, selectors, value) {
  if (!value)
    throw new Error(
      `fillDomInput: no value was given for ${selectors.join(', ')}`,
    );
  const filled = await page.evaluate(
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
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .find((node) => visible(node));
      if (!field) return false;
      field.scrollIntoView({ block: 'center', inline: 'center' });
      field.focus();
      const prototype =
        field instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(
        field,
        inputValue,
      );
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
  );
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
