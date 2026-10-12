// The 10.4 table, bound to the page: reading it, opening, editing or deleting
// the row about a legal act, and adding a new one. Which row is about an act is
// judged by the model over every row's text (`rowAbout`): the table names a
// statute by its full title, its short name or its journal reference, and a
// list of the phrases one person once saw misses the next spelling.
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';
import {
  chooseDeleteInRowMenu,
  confirmDeletion,
} from '../../../../_shared/ncbr/row_menu.mjs';
import { rowAbout } from '../../../../_shared/page/judged/matched.mjs';
import { staleActs } from './source.mjs';

const ROWS = 'table tbody tr';
const ROW_MENU =
  'button[aria-label="overflow-options"], button, [role="button"]';

export function legalActsTable({ page }) {
  async function tableState() {
    return page.evaluate(() => ({
      url: location.href,
      tables: Array.from(document.querySelectorAll('table')).map(
        (table, index) => ({
          index,
          rows: Array.from(table.querySelectorAll('tbody tr')).map(
            (row, rowIndex) => ({
              rowIndex,
              text: row.innerText.trim().replace(/\s+/g, ' '),
              buttons: Array.from(
                row.querySelectorAll('button, [role="button"]'),
              ).map((button) => ({
                text: button.textContent.trim(),
                aria: button.getAttribute('aria-label'),
              })),
            }),
          ),
        }),
      ),
    })); // allow-raw-playwright: read 10.4 table state only
  }

  /** Every row's visible text, whitespace collapsed. */
  async function rowTexts() {
    return (await page.locator(ROWS).allInnerTexts()).map((text) =>
      text.trim().replace(/\s+/g, ' '),
    );
  }

  /** The row about `subject`, with its text, or null when no row is. */
  async function rowAboutSubject(subject) {
    const texts = await rowTexts();
    const index = await rowAbout(texts, subject);
    if (index === null) return null;
    return { row: page.locator(ROWS).nth(index), text: texts[index] };
  }

  /** Opens the menu of the row about `subject`; says why when it cannot. */
  async function openMenuAbout(subject) {
    const found = await rowAboutSubject(subject);
    if (!found)
      return {
        opened: false,
        reason: 'no row is about the act',
        subject,
        rows: await rowTexts(),
      };
    const button = found.row.locator(ROW_MENU).first();
    if ((await button.count()) === 0)
      return { opened: false, reason: 'row menu not found', row: found.text };
    await humanClickLocator(page, button);
    await humanIdlePause('deliberate');
    return { opened: true, row: found.text };
  }

  /** Opens the editor of the row about `subject`, or throws naming it. */
  async function openRowAbout(subject) {
    const menu = await openMenuAbout(subject);
    if (!menu.opened) throw new Error(JSON.stringify(menu));
    await humanClickLocator(
      page,
      page.getByRole('menuitem', { name: 'Edytuj', exact: true }).first(),
    );
    await humanIdlePause('long');
    return menu;
  }

  /** Opens the row of the outdated act the application must no longer cite. */
  async function openOutdatedRow() {
    const [outdated] = staleActs;
    return openRowAbout(outdated);
  }

  async function deleteRowAbout(subject) {
    const opened = await openMenuAbout(subject);
    if (!opened.opened) return { skipped: opened };
    await chooseDeleteInRowMenu(page);
    const confirmed = await confirmDeletion(page);
    await humanIdlePause('long');
    return { opened, confirmed };
  }

  async function clickAdd() {
    const button = page
      .getByRole('button', { name: 'Dodaj', exact: true })
      .filter({ visible: true })
      .first();
    if ((await button.count()) === 0)
      throw new Error('enabled Dodaj not found');
    await humanClickLocator(page, button);
    await humanIdlePause('long');
  }
  return {
    tableState,
    rowAboutSubject,
    openOutdatedRow,
    openRowAbout,
    openMenuAbout,
    deleteRowAbout,
    clickAdd,
  };
}
