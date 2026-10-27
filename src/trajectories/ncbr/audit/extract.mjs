// Reads the written answers of one LSI2 section, read-only.
//
// A written answer is a multi-line text field (a textarea) that holds text:
// the form itself marks which fields take prose, so no length decides it.
// With rows included, every row of the section's table is opened through its
// own "Edytuj" menu entry and the drawer's answers are read under the row's
// visible text; a row that cannot be opened fails the extraction instead of
// being skipped. Each step waits on the page, never on a pause.
import { dismissCookieNotice } from '#ncbr-cookie-notice';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickSafe, closeDrawer, gotoSafe } from '../correction/ui.mjs';

const ROW_MENU = 'button[aria-label="overflow-options"]';

function tableRows(page) {
  return page.locator('table tbody tr').filter({ has: page.locator(ROW_MENU) });
}

/** The page's textareas that hold text, each with its name and its label. */
async function answers(page) {
  return page.evaluate(() => {
    const labelFor = (el) => {
      if (el.id) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) return lab.textContent.trim();
      }
      // The nearest label within the field's own group; a label above the first
      // ancestor holding another field names that field, not this one.
      for (let node = el.parentElement; node; node = node.parentElement) {
        const lab = node.querySelector('label, .MuiFormLabel-root, legend');
        if (lab?.textContent) return lab.textContent.trim();
        if (
          Array.from(node.querySelectorAll('input, textarea, select')).some(
            (f) => f !== el,
          )
        )
          break;
      }
      return null;
    };
    return Array.from(document.querySelectorAll('textarea'))
      .filter((el) => el.name && el.value.trim())
      .map((el) => ({ name: el.name, label: labelFor(el), value: el.value }));
  }); // allow-raw-playwright: read-only extraction from the form's text answers
}

/** A field's heading: its row's text when it came from a row, its label, its name. */
const heading = (field) =>
  [field.row, field.label, field.name].filter(Boolean).join(' · ');

/** The fields as one Markdown text, a heading per field. */
function joinFields(fields) {
  return fields
    .map((field) => `## ${heading(field)}\n\n${field.value.trim()}`)
    .join('\n\n---\n\n');
}

async function openRowAt(page, section, index, projectUrl) {
  await gotoSafe(page, section.url, projectUrl);
  await pageSettled(page);
  const row = tableRows(page).nth(index);
  await clickSafe(row.locator(ROW_MENU), 'row menu');
  await clickSafe(
    page
      .getByRole('menuitem', { name: 'Edytuj', exact: true })
      .filter({ visible: true }),
    'Edytuj',
  );
  await page
    .getByRole('button', { name: 'close side drawer', exact: true })
    .filter({ visible: true })
    .last()
    .waitFor({ state: 'visible' });
}

/** The section's answers, and with `includeRows` its table rows' answers. */
export async function extractSection(page, section, projectUrl, includeRows) {
  console.error(`[ncbr-pangram] extracting ${section.id} ${section.title}`);
  await gotoSafe(page, section.url, projectUrl);
  await pageSettled(page);
  await dismissCookieNotice(page);
  const fields = await answers(page);
  const rowFields = [];
  if (includeRows) {
    const rows = await tableRows(page).evaluateAll((nodes) =>
      nodes.map((node) => node.innerText.replace(/\s+/g, ' ').trim()),
    ); // allow-raw-playwright: read-only row texts
    console.error(
      `[ncbr-pangram] ${section.id}: answers=${fields.length} rows=${rows.length}`,
    );
    const sectionNames = new Set(fields.map((field) => field.name));
    for (const [index, rowText] of rows.entries()) {
      await openRowAt(page, section, index, projectUrl);
      // The section's own form stays in the page behind the drawer.
      for (const field of await answers(page))
        if (!sectionNames.has(field.name))
          rowFields.push({ ...field, row: rowText });
      await closeDrawer(page);
    }
  }
  return { fields, rowFields, text: joinFields([...fields, ...rowFields]) };
}
