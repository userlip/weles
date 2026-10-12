// Section 1.3 (Podmioty realizujące projekt) of the NEW NCBR wniosek.
// Replicates the working Kimi reference cdp_fill_1_3.py. Never closes the page.

import {
  applicantField,
  applicantShortName,
  cdpEndpoint,
  sectionUrl,
} from '#ncbr-settings';
import { chromium } from 'playwright';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../../dist/human/keyboard.js';
import { selectRadio } from '../../../form-input.mjs';

const endpoint = cdpEndpoint();
// The section id differs per application, so it is declared beside the project id.
const SECTION_URL = sectionUrl('1_3');

// The applicant's registry data, phone and addresses live in the applicant
// record in the private application folder, never in this repository. Each
// form field reads the record field of the same name.
const FIELD = applicantField;

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
  const count = await saves.count();
  if (!count) throw new Error('no enabled Zapisz');
  await humanClickLocator(page, saves.nth(count - 1));
  await humanIdlePause('long');
  await humanIdlePause('deliberate');
}
async function radio(value) {
  await selectRadio(
    page,
    page.locator(`input[type="radio"][value="${value}"]`).first(),
  );
}
async function text(name, value) {
  await humanFill(page, page.locator(`[name="${name}"]`).first(), value);
}
async function setAuto(name, value) {
  const inp = page.locator(`input[name="${name}"]`).first();
  await humanFill(page, inp, value);
  await humanIdlePause('deliberate');
  const opts = page.locator("[role='listbox'] [role='option']");
  if ((await opts.count()) === 0)
    throw new Error(`1.3 no options: ${name} -> ${value}`);
  await opts.first().dispatchEvent('click'); // allow-raw-playwright: pick filtered option (Kimi reference)
  await humanIdlePause('short');
}

await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' });
await humanIdlePause('long');
await (await import('#ncbr-cookie-notice')).dismissCookieNotice(page); // allow-raw-playwright: neutralise cookie banner (Kimi reference)

await clickDodaj(0);
await page
  .locator("textarea[name='nazwa']")
  .first()
  .waitFor({ state: 'visible' });

await radio('wnioskodawca_samodzielny');
await text('nazwa', FIELD('nazwa'));
await text('nazwa_skrocona', applicantShortName());
await text(
  'data_rozpoczecia_dzialalnosci',
  FIELD('data_rozpoczecia_dzialalnosci'),
);
await radio('przedsiebiorstwo');
await setAuto('forma_prawna', FIELD('forma_prawna'));
await setAuto('forma_wlasnosci', FIELD('forma_wlasnosci'));
await setAuto('wielkosc_podmiotu', FIELD('wielkosc_podmiotu'));
await radio(FIELD('spolka_celowa'));
await text('nip', FIELD('nip'));
await text('regon', FIELD('regon'));
await text(
  'numer_w_krajowym_rejestrze_sadowym',
  FIELD('numer_w_krajowym_rejestrze_sadowym'),
);
await radio('pkd_2007');
await setAuto('pkd_2007', FIELD('pkd_2007'));
await setAuto('mozliwosc_odzyskania_vat', FIELD('mozliwosc_odzyskania_vat'));
await text(
  'uzasadnienie_braku_mozliwosci_odzyskania_vat',
  FIELD('uzasadnienie_braku_mozliwosci_odzyskania_vat'),
);
await setAuto('wojewodztwo_podmiot', FIELD('wojewodztwo_podmiot'));
await setAuto('powiat_podmiot', FIELD('powiat_podmiot'));
await setAuto('gmina_podmiot', FIELD('gmina_podmiot'));
await setAuto('miejscowosc_podmiot', FIELD('miejscowosc_podmiot'));
await text('kod_pocztowy_podmiot', FIELD('kod_pocztowy_podmiot'));
await setAuto('ulica_podmiot', FIELD('ulica_podmiot'));
await text('nr_budynku_podmiot', FIELD('nr_budynku_podmiot'));
await text('telefon_podmiot', FIELD('telefon'));
await text('adres_email_podmiot', FIELD('email'));
await text('www_podmiot', FIELD('www_podmiot'));
await text('adres_e_doreczenie_podmiot', FIELD('e_doreczenie'));

let saveResult = 'saved';
try {
  await saveForm();
} catch (e) {
  saveResult = `NOT SAVED: ${String(e?.message || e)}`;
}

const readback = await page.evaluate((applicant) => {
  const tbl = document.querySelector('table');
  let rows = -1;
  if (tbl) rows = tbl.querySelectorAll('tbody tr').length;
  const listsApplicant = document.body.innerText.includes(applicant);
  return { entityRows: rows, listsApplicant };
}, applicantShortName());

console.log(JSON.stringify({ saveResult, readback }, null, 2));
process.exit(0);
