// The LSI2 criterion-1 attachment drawer, read and driven through its own
// controls: the file labels the widget renders, its ready mark, its row menu.

import { mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';

const CRITERION_LABEL =
  'Załączniki potwierdzające spełnienie warunku określonego w kryterium nr 1';
export const APPLICANT = (await import('#ncbr-settings')).applicantShortName();
const READY_MARK = 'svg[data-testid="CheckCircleIcon"]';

export function fileLabel(page, name) {
  return page
    .locator(`p[title=${JSON.stringify(name)}]`)
    .filter({ visible: true });
}

/** Every PDF the drawer lists, with whether the widget marked it ready. */
export async function readUploaded(page) {
  return page
    .locator('p[title$=".pdf"]')
    .filter({ visible: true })
    .evaluateAll(
      (labels, mark) =>
        labels.map((label) => ({
          name: label.getAttribute('title'),
          detail: label.parentElement.innerText,
          ready: Boolean(label.parentElement.querySelector(mark)),
        })),
      READY_MARK,
    );
}

/** The drawer's rows against the declared names. */
export function compareFiles(rows, declaredNames) {
  const names = rows.map((row) => row.name);
  return {
    rows,
    missing: declaredNames.filter((name) => !names.includes(name)),
    extra: names.filter((name) => !declaredNames.includes(name)),
    complete:
      names.length === declaredNames.length &&
      new Set(names).size === names.length &&
      declaredNames.every((name) => names.includes(name)) &&
      rows.every((row) => row.ready),
  };
}

export async function downloadFile(page, name, folder) {
  mkdirSync(folder, { recursive: true });
  const pending = page.waitForEvent('download');
  await humanClickLocator(page, fileLabel(page, name));
  const download = await pending;
  const path = join(folder, name);
  await download.saveAs(path);
  const failure = await download.failure();
  if (failure) throw new Error(`Download failed for ${name}: ${failure}`);
  const bytes = readFileSync(path);
  return {
    name,
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function closeDrawer(page) {
  await humanClickLocator(
    page,
    page.getByRole('button', { name: 'close side drawer', exact: true }),
  );
}

export async function openExistingCriterion1Edit(page) {
  const [menu, ...others] = await page
    .locator('table tbody tr')
    .filter({ hasText: APPLICANT })
    .locator('button[aria-label="overflow-options"]')
    .filter({ visible: true })
    .all();
  if (!menu || others.length)
    throw new Error(
      `Expected one existing ${APPLICANT} criterion-1 attachment row`,
    );
  await humanClickLocator(page, menu);
  const item = page.getByRole('menuitem', { name: 'Edytuj', exact: true });
  await item.waitFor({ state: 'visible' });
  await humanClickLocator(page, item);
  await humanIdlePause('long');
}

/** The Add control of the criterion-1 collection: the first below its label. */
export async function openCriterion1Add(page) {
  const label = page
    .getByText(CRITERION_LABEL, { exact: false })
    .filter({ visible: true })
    .first();
  if (!(await label.count())) throw new Error('criterion-1 label not found');
  const labelBox = await label.boundingBox();
  const addButtons = await page
    .getByRole('button', { name: 'Dodaj', exact: true })
    .filter({ visible: true })
    .all();
  let addButton = null;
  for (const candidate of addButtons) {
    const box = await candidate.boundingBox();
    if (box && labelBox && box.y > labelBox.y) {
      addButton = candidate;
      break;
    }
  }
  if (!addButton) throw new Error('criterion-1 Dodaj not found');
  await humanClickLocator(page, addButton);
  await humanIdlePause('long');
}

/** Choose the applicant in the new row; the outcome as a sentence. */
export async function selectApplicant(page) {
  const input = page.locator("input[name*='nazwa_skrocona']").first();
  if (!(await input.count())) return 'no applicant input';
  const applicantSelect = page
    .locator('.MuiInputBase-root:has(input[name*="nazwa_skrocona"])')
    .locator('.MuiSelect-select, [role="combobox"]')
    .first();
  if (await applicantSelect.count())
    await humanClickLocator(page, applicantSelect);
  await humanIdlePause('deliberate');
  const opt = page
    .getByRole('option', { name: APPLICANT, exact: true })
    .first();
  if (!(await opt.count())) return `no ${APPLICANT} option`;
  await opt.dispatchEvent('click'); // allow-raw-playwright: select applicant
  await humanIdlePause('short');
  return 'selected';
}

/** Wait until the widget marks `name` ready. */
export async function waitReady(page, name) {
  await page.waitForFunction(
    ({ wanted, mark }) => {
      const label = Array.from(document.querySelectorAll('p[title]')).find(
        (element) => element.title === wanted,
      );
      return Boolean(label?.parentElement.querySelector(mark));
    },
    { wanted: name, mark: READY_MARK },
    { polling: 'raf' },
  );
}
