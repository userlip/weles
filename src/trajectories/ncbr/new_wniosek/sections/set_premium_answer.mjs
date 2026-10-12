// Sets the radio answers of one premium collection row (sections 5.3/5.4). UI-only.
// Never submits and never closes the page.
//
// NCBR_PREMIUM_SECTION names the section key (5_3 or 5_4, as NCBR_SECTION_<key>
// declares its page). NCBR_PREMIUM_ANSWERS is a JSON object mapping each radio
// group's name to the value to choose; DIAG=1 lists the row's radio groups and
// their values instead. Nothing is assumed: no default answer, no radio picked
// by its position on the page, no banner found by its wording — the radios are
// chosen by their own name and value and the row is saved from the keyboard.

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
  'NCBR_PREMIUM_SECTION',
  'the premium section key whose row is answered, as NCBR_SECTION_<key> names its page',
);
const diagnose = Boolean(process.env.DIAG);
const answers = diagnose
  ? {}
  : JSON.parse(
      stated(
        'NCBR_PREMIUM_ANSWERS',
        'a JSON object mapping each radio group name to the value to choose (DIAG=1 lists them)',
      ),
    );

const endpoint = settings.cdpEndpoint();
const browser = await chromium.connectOverCDP(endpoint);
const [context] = browser.contexts();
const [page] = context ? context.pages() : [];
if (!page) throw new Error(`no page is open over ${endpoint}`);

await page.goto(settings.sectionBase() + settings.sectionId(section), {
  waitUntil: 'domcontentloaded',
});
await humanIdlePause('long');

const rowMenu = page
  .locator('table tbody tr button[aria-label="overflow-options"]')
  .first();
await rowMenu.dispatchEvent('click'); // allow-raw-playwright: open premium row menu
await humanIdlePause('deliberate');
await page
  .getByRole('menuitem', { name: 'Edytuj', exact: true })
  .first()
  .dispatchEvent('click'); // allow-raw-playwright: edit premium row
await humanIdlePause('long');

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
  throw new Error('the premium row Save button is disabled');
await save.press('Enter'); // activate only this Save button from the keyboard
await page
  .getByRole('button', { name: 'close side drawer', exact: true })
  .waitFor({ state: 'hidden' });

console.log(
  JSON.stringify(
    { section, answers, before, chosen, saved: true },
    null,
    INDENT,
  ),
);
process.exit();
