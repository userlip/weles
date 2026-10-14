// The form actions every NCBR script performs on LSI (NCBR's application
// system): saving the open form, deleting the table rows that carry a text,
// and filling the entity's e-Doręczenia address. Each takes the page it acts
// on; scripts import them from here, never from a copy of their own.

import { humanClickLocator, humanIdlePause } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../page/settled.mjs';
import { chooseDeleteInRowMenu, confirmDeletion } from './row_menu.mjs';

// LSI renders an enabled, visible "Zapisz" for each open form, the innermost
// sub-form's last. The page is settled first, so a button the last input is
// about to enable is enabled; when none is, the save is refused with the text
// of every field LSI marks invalid, which is why it will not save.
export async function saveLsiForm(page) {
  await pageSettled(page);
  const saves = page
    .getByRole('button', { name: 'Zapisz', exact: true, disabled: false })
    .filter({ visible: true });
  if (!(await saves.count())) {
    const invalid = await page
      .locator('[aria-invalid="true"], .Mui-error')
      .allTextContents();
    throw new Error(
      `the LSI form offers no enabled Zapisz; fields it marks invalid: ${JSON.stringify(invalid)}`,
    );
  }
  await humanClickLocator(page, saves.last());
  await humanIdlePause('long');
  await pageSettled(page);
}

// Deletes, through each row's own menu, every table row whose text contains
// `needle` (whitespace collapsed), and returns one entry per deleted row.
export async function deleteLsiRowsContaining(page, needle) {
  const deleted = [];
  const present = () =>
    page.evaluate(
      (text) =>
        Array.from(document.querySelectorAll('table tbody tr')).some((row) =>
          row.innerText.replace(/\s+/g, ' ').trim().includes(text),
        ),
      needle,
    ); // allow-raw-playwright: read the table rows
  while (await present()) {
    const row = page.locator('table tbody tr').filter({ hasText: needle }).first();
    await humanClickLocator(
      page,
      row.locator('button[aria-label="overflow-options"]'),
    ); // allow-raw-playwright: open the row's own menu
    await humanIdlePause('deliberate');
    await chooseDeleteInRowMenu(page);
    await confirmDeletion(page);
    await humanIdlePause('long');
    deleted.push(needle);
  }
  return deleted;
}

// The entity form names its e-Doręczenia address field; it is found by that
// name, not by words in its label. A form without the field, or with it locked,
// answers found/filled as observed; a filled field is not saved here.
export function fillLsiEdoreczenia(page, value) {
  return page.evaluate((address) => {
    const hit = document.querySelector(
      'input[name$="adres_e_doreczenie_podmiot"], textarea[name$="adres_e_doreczenie_podmiot"]',
    );
    if (!hit || hit.disabled || hit.readOnly)
      return { found: Boolean(hit), filled: false };
    const proto =
      hit instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(hit, address);
    hit.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: address,
      }),
    );
    hit.dispatchEvent(new Event('change', { bubbles: true }));
    hit.dispatchEvent(new Event('blur', { bubbles: true }));
    return { found: true, filled: true, name: hit.name, id: hit.id };
  }, value); // allow-raw-playwright: fill the e-Doręczenia field LSI renders
}
