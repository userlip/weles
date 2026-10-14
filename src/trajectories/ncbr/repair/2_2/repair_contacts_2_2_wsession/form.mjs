// The LSI form helpers of repair_contacts_2_2_wsession.mjs, bound to the page they act on.
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../../dist/human/keyboard.js';
import { assertFits } from '../../../form-input.mjs';
import { EDORECZENIA } from './source.mjs';
import {
  deleteLsiRowsContaining,
  fillLsiEdoreczenia,
  saveLsiForm,
} from '../../../../_shared/ncbr/lsi_form.mjs';

export function lsiForm({ page, session, email, password, progress }) {
  async function setReactInputValue(locator, value) {
    await locator.waitFor({ state: 'visible' });
    await humanClickLocator(page, locator); // allow-raw-playwright: focus visible LSI input
    let next = String(value || '');
    const max = await assertFits(locator, next);
    const locked = await locator.evaluate((el) =>
      Boolean(el.readOnly || el.disabled),
    ); // allow-raw-playwright: inspect visible field mutability
    if (!locked) {
      await humanFill(page, locator, ''); // allow-raw-playwright: clear editable LSI field
      await humanFill(page, locator, next); // allow-raw-playwright: fill editable LSI field
    }
    await locator.evaluate((el, v) => {
      const proto =
        el instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, v);
      else el.value = v;
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertText',
          data: v,
        }),
      );
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, next); // allow-raw-playwright: set React-controlled LSI field value
    await humanIdlePause('short');
    return { len: next.length, max };
  }

  async function login() {
    progress('login:start');
    await page.goto(
      `${(await import('#ncbr-settings')).lsi2Origin()}/logowanie`,
      {
        waitUntil: 'domcontentloaded',
      },
    ); // allow-raw-playwright: LSI login page
    await humanIdlePause('long');
    await setReactInputValue(
      page.locator('#mail, input[name="mail"]').first(),
      email,
    );
    await setReactInputValue(
      page.locator('#password, input[name="password"]').first(),
      password,
    );
    const checkbox = page
      .locator('#isStatuteAccepted, input[name="isStatuteAccepted"]')
      .first();
    if (!(await checkbox.isChecked().catch(() => false)))
      await humanClickLocator(page, checkbox); // allow-raw-playwright: accept visible statute checkbox for login only
    await page.waitForFunction(
      () => {
        const btn =
          document.querySelector('#login-btn') ||
          Array.from(document.querySelectorAll('button')).find(
            (b) => b.innerText.trim() === 'Zaloguj',
          );
        return !!btn && !btn.disabled;
      },
      null,
      { polling: 'raf' },
    ); // allow-raw-playwright: wait for login validation
    for (
      let attempt = 1;
      attempt <= 3 && page.url().includes('/logowanie');
      attempt += 1
    ) {
      await session.clickSelector('#login-btn, button:has-text("Zaloguj")'); // allow-raw-playwright: click visible login button
      await page.waitForLoadState('load');
      await humanIdlePause('long');
    }
    if (page.url().includes('/logowanie'))
      throw new Error('login stayed on login page');
    progress('login:done');
  }

  async function clickVisibleButton(text, nth = 0) {
    const buttons = page
      .locator('button:visible')
      .filter({ hasText: new RegExp(`^${text}$`) });
    if ((await buttons.count()) <= nth)
      throw new Error(`${text} #${nth} not found`);
    await humanClickLocator(page, buttons.nth(nth)); // allow-raw-playwright: click visible LSI button
    await humanIdlePause('long');
  }

  const saveVisibleForm = () => saveLsiForm(page);

  async function fillAny(names, value) {
    for (const name of names) {
      const visible = page.locator(
        `input[name="${name}"]:visible, textarea[name="${name}"]:visible`,
      );
      const loc =
        (await visible.count()) > 0
          ? visible.last()
          : page
              .locator(`input[name="${name}"], textarea[name="${name}"]`)
              .last();
      if ((await loc.count()) === 0) continue;
      return { name, ...(await setReactInputValue(loc, value)) };
    }
    throw new Error(`none of fields found: ${names.join(', ')}`);
  }

  async function fillByName(name, value) {
    return fillAny([name], value);
  }

  function deleteRowsContaining(needle) {
    progress(`1.3:delete:${needle}`);
    return deleteLsiRowsContaining(page, needle);
  }

  const fillEdoreczeniaIfPresent = () => fillLsiEdoreczenia(page, EDORECZENIA);
  return {
    setReactInputValue,
    login,
    clickVisibleButton,
    saveVisibleForm,
    fillAny,
    fillByName,
    deleteRowsContaining,
    fillEdoreczeniaIfPresent,
  };
}
