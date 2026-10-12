// Sets the radio answers of one collection row in any section of the draft
// (4.3, 5.3, 5.4 and any other Tak/Nie collection). Never submits.
//
// NCBR_COLLECTION_SECTION names the section key (as NCBR_SECTION_<key>
// declares its page). NCBR_COLLECTION_ANSWERS is a JSON object mapping each
// radio group's name to the value to choose; DIAG=1 lists the row's radio
// groups and their values instead. NCBR_COLLECTION_APPLICANT, when the row asks
// for one, is the applicant option to choose. The first row is edited, or a row
// is added when the section has none. Nothing is assumed: no default answer,
// no radio picked by its position, no applicant name and no banner found by its
// wording — radios are chosen by name and value, read back, and the row is saved
// from the keyboard.

import { chromium } from 'playwright';
import { humanIdlePause } from '../../../../../dist/human/mouse.js';

const INDENT = '  ';
const settings = await import('#ncbr-settings');

function stated(name, meaning) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required: ${meaning}`);
  return value;
}

const section = stated(
  'NCBR_COLLECTION_SECTION',
  'the section key whose collection row is answered, as NCBR_SECTION_<key> names its page',
);
const diagnose = Boolean(process.env.DIAG);
const answers = diagnose
  ? {}
  : JSON.parse(
      stated(
        'NCBR_COLLECTION_ANSWERS',
        'a JSON object mapping each radio group name to the value to choose (DIAG=1 lists them)',
      ),
    );
const applicant = process.env.NCBR_COLLECTION_APPLICANT;

const endpoint = settings.cdpEndpoint();
const browser = await chromium.connectOverCDP(endpoint);
const [context] = browser.contexts();
const [page] = context ? context.pages() : [];
if (!page) throw new Error(`no page is open over ${endpoint}`);

await page.goto(settings.sectionBase() + settings.sectionId(section), {
  waitUntil: 'domcontentloaded',
});
await humanIdlePause('long');

const rowMenus = page.locator(
  'table tbody tr button[aria-label="overflow-options"]',
);
if (await rowMenus.count()) {
  await rowMenus.first().dispatchEvent('click'); // allow-raw-playwright: open the row menu
  await humanIdlePause('deliberate');
  await page
    .getByRole('menuitem', { name: 'Edytuj', exact: true })
    .first()
    .dispatchEvent('click'); // allow-raw-playwright: edit the row
} else {
  const add = page
    .getByRole('button', { name: 'Dodaj', exact: true })
    .filter({ visible: true })
    .first();
  if (!(await add.count()))
    throw new Error(`section ${section} has no row and no Dodaj control`);
  await add.dispatchEvent('click'); // allow-raw-playwright: add a row
}
await humanIdlePause('long');

const applicantSelect = page
  .locator('input[name*="nazwa_skrocona_wnioskodawcy"]')
  .locator('xpath=ancestor::*[contains(@class, "MuiInputBase-root")][1]')
  .locator('.MuiSelect-select, [role="combobox"]')
  .first();
if (await applicantSelect.count()) {
  if (!applicant)
    throw new Error(
      'NCBR_COLLECTION_APPLICANT is required: this row asks which applicant it is for',
    );
  await applicantSelect.dispatchEvent('mousedown'); // allow-raw-playwright: open the applicant list
  await humanIdlePause('deliberate');
  const option = page
    .getByRole('option', { name: applicant, exact: true })
    .first();
  if (!(await option.count()))
    throw new Error(
      `the applicant list offers no ${JSON.stringify(applicant)}`,
    );
  await option.dispatchEvent('click'); // allow-raw-playwright: choose the stated applicant
  await humanIdlePause('short');
}

/** Every radio group in the open row: its name, values and chosen value. */
async function radioGroups() {
  return page.locator('input[type="radio"]').evaluateAll((radios) => {
    const groups = {};
    for (const radio of radios) {
      if (!Object.hasOwn(groups, radio.name))
        groups[radio.name] = { values: [], chosen: null };
      groups[radio.name].values.push(radio.value);
      if (radio.checked) groups[radio.name].chosen = radio.value;
    }
    return groups;
  });
}

const before = await radioGroups();
if (diagnose) {
  console.log(JSON.stringify({ section, groups: before }, null, INDENT));
  process.exit();
}

for (const [name, value] of Object.entries(answers)) {
  if (!before[name]?.values.includes(value))
    throw new Error(
      `the row has no radio group ${JSON.stringify(name)} offering ${JSON.stringify(value)}; DIAG=1 lists what it offers`,
    );
  await page
    .locator(
      `input[type="radio"][name=${JSON.stringify(name)}][value=${JSON.stringify(value)}]`,
    )
    .first()
    .dispatchEvent('click'); // allow-raw-playwright: choose the stated answer
  await humanIdlePause('short');
}

const chosen = await radioGroups();
const unset = Object.entries(answers).filter(
  ([name, value]) => chosen[name]?.chosen !== value,
);
if (unset.length)
  throw new Error(
    `the row did not take ${unset.map(([name, value]) => `${name}=${value}`).join(', ')}; nothing was saved`,
  );

const save = page
  .getByRole('button', { name: 'Zapisz', exact: true })
  .filter({ visible: true })
  .last();
if (!(await save.isEnabled()))
  throw new Error(`the ${section} row Save button is disabled`);
await save.press('Enter'); // activate only this Save button from the keyboard
await page
  .getByRole('button', { name: 'close side drawer', exact: true })
  .waitFor({ state: 'hidden' });

console.log(
  JSON.stringify(
    { section, applicant, answers, before, chosen, saved: true },
    null,
    INDENT,
  ),
);
process.exit();
