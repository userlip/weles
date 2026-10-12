// Section 1.5 (Miejsce realizacji projektu) of the NEW NCBR wniosek.
// Collection row: applicant + address dictionaries + street/number. Never closes page.

import { chromium } from 'playwright';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../../dist/human/keyboard.js';

const endpoint = (await import('#ncbr-settings')).cdpEndpoint();
const SECTION_URL = (await import('#ncbr-settings')).sectionUrl('1_5');

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) {
  console.log(JSON.stringify({ error: 'NO_PAGE' }));
  process.exit(1);
}

async function clickDodaj(nth) {
  const button = page
    .getByRole('button', { name: 'Dodaj', exact: true })
    .nth(nth);
  if ((await button.count()) === 0) throw new Error(`Dodaj #${nth} not found`);
  await humanClickLocator(page, button);
  await humanIdlePause('long');
}
async function saveForm() {
  const saves = page
    .getByRole('button', { name: 'Zapisz', exact: true })
    .filter({ visible: true });
  const enabled = saves.filter({ hasNot: page.locator('[disabled]') });
  if ((await enabled.count()) === 0) throw new Error('no enabled Zapisz');
  await humanClickLocator(page, enabled.last());
  await humanIdlePause('long');
  await humanIdlePause('deliberate');
}
async function setApplicant() {
  const applicant = page
    .locator(
      'input[name="nazwa_skrocona_wnioskodawcy_samodzielnego_lidera_konsorcjum_konsorcjanta"]',
    )
    .locator('xpath=ancestor::*[contains(@class, "MuiInputBase-root")][1]')
    .locator('.MuiSelect-select, [role="combobox"]')
    .first();
  if ((await applicant.count()) > 0) await humanClickLocator(page, applicant);
  const opt = page
    .getByRole('option', {
      name: (await import('#ncbr-settings')).applicantShortName(),
      exact: true,
    })
    .first();
  await opt.waitFor({ state: 'visible' });
  await humanClickLocator(page, opt);
  await humanIdlePause('short');
}
async function setAuto(name, value) {
  const inp = page.locator(`input[name$="${name}"]`).first();
  await humanClickLocator(page, inp);
  await humanFill(page, inp, '');
  await humanFill(page, inp, value);
  await humanIdlePause('deliberate');
  const opts = page.locator("[role='listbox'] [role='option']");
  if ((await opts.count()) === 0)
    throw new Error(`no options: ${name} -> ${value}`);
  await opts.first().dispatchEvent('click'); // allow-raw-playwright: pick option
  await humanIdlePause('short');
}

await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' });
await humanIdlePause('long');
await (await import('#ncbr-cookie-notice')).dismissCookieNotice(page); // allow-raw-playwright: neutralise cookie banner

await clickDodaj(0);
await humanIdlePause('deliberate');

if (process.env.DIAG) {
  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,textarea'))
      .map((i) => ({
        tag: i.tagName,
        name: i.name,
        role: i.getAttribute('role'),
        label: (
          document.querySelector(`label[for="${i.id}"]`)?.textContent || ''
        ).trim(),
      }))
      .filter((f) => f.name),
  );
  console.log(JSON.stringify(fields, null, 2));
  process.exit(0);
}

try {
  await setApplicant();
} catch (e) {
  /* auto-assigned */
}
// The implementation place is the applicant record's miejsce_realizacji_*
// fields, under the form's own field names.
const PLACE = (await import('#ncbr-settings')).applicantField;
for (const name of [
  'miejsce_realizacji_wojewodztwo',
  'miejsce_realizacji_powiat',
  'miejsce_realizacji_gmina',
  'miejsce_realizacji_miejscowosc',
  'miejsce_realizacji_ulica',
])
  await setAuto(name, PLACE(name));
await humanFill(
  page,
  page.locator("[name$='miejsce_realizacji_nr_budynku']").first(),
  PLACE('miejsce_realizacji_nr_budynku'),
);
await humanIdlePause('deliberate');
await humanIdlePause('deliberate');
let saveResult = 'saved';
try {
  await saveForm();
} catch (e) {
  saveResult = `NOT SAVED: ${String(e?.message || e)}`;
}

const readback = await page.evaluate(() => {
  const tbl = document.querySelector('table');
  let rows = -1;
  if (tbl) rows = tbl.querySelectorAll('tbody tr').length;
  return { rows };
});
console.log(JSON.stringify({ saveResult, readback }, null, 2));
process.exit(0);
