// Repair section 1.3 contact-person collection. UI-only; never closes page.

import { chromium } from 'playwright';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../../../dist/human/keyboard.js';
import { assertFits } from '../../../../form-input.mjs';
import {
  deleteLsiRowsContaining,
  fillLsiEdoreczenia,
  saveLsiForm,
} from '../../../../../_shared/ncbr/lsi_form.mjs';

const endpoint = (await import('#ncbr-settings')).cdpEndpoint();
const SECTION_URL = (await import('#ncbr-settings')).sectionUrl('1_3');
// People's names, phones and addresses live in the applicant record in the
// private application folder, never in this repository.
// The record's contacts are the people the section must list; its
// withdrawn_contacts ("imie nazwisko") are removed from the section.
const CONTACTS = (await import('#ncbr-settings')).applicantList('contacts');
const WITHDRAWN = (await import('#ncbr-settings')).applicantList(
  'withdrawn_contacts',
);
const EDORECZENIA = (await import('#ncbr-settings')).applicantField(
  'e_doreczenie',
);

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) {
  console.log(JSON.stringify({ error: 'NO_PAGE' }));
  process.exit(1);
}

await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' });
await humanIdlePause('long');
await (await import('#ncbr-cookie-notice')).dismissCookieNotice(page); // allow-raw-playwright: neutralise cookie banner

async function clickDodajContact() {
  const buttons = page
    .getByRole('button', { name: 'Dodaj', exact: true })
    .filter({ visible: true });
  if ((await buttons.count()) <= 1)
    throw new Error(`contact Dodaj not found; count=${await buttons.count()}`);
  await humanClickLocator(page, buttons.nth(1));
  await humanIdlePause('long');
}

if (process.env.DIAG) {
  await clickDodajContact();
  const out = await page.evaluate(() => ({
    fields: Array.from(document.querySelectorAll('input, textarea'))
      .map((el) => {
        const label = el.id
          ? document
              .querySelector(`label[for="${CSS.escape(el.id)}"]`)
              ?.textContent?.trim()
          : null;
        const wrap = el.closest(
          'label, .MuiFormControl-root, .MuiFormGroup-root, .MuiBox-root',
        );
        return {
          tag: el.tagName,
          type: el.getAttribute('type') || null,
          name: el.getAttribute('name') || null,
          role: el.getAttribute('role') || null,
          max: el.getAttribute('maxlength') || null,
          value: el.value || '',
          label,
          nearby: wrap ? wrap.textContent.trim() : null,
        };
      })
      .filter((f) => f.name || f.label || f.nearby),
    buttons: Array.from(document.querySelectorAll('button'))
      .map((b) => b.innerText.trim())
      .filter(Boolean),
  }));
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

async function fillAny(names, value) {
  for (const name of names) {
    const loc = page.locator(`[name="${name}"]`).first();
    if ((await loc.count()) === 0) continue;
    const max = await assertFits(loc, value);
    const v = value;
    await humanFill(page, loc, v);
    return `${name} ${v.length}/${max}`;
  }
  throw new Error(`none of fields found: ${names.join(', ')}`);
}

const deleted = [];
for (const person of WITHDRAWN)
  deleted.push(...(await deleteLsiRowsContaining(page, person)));
const edoreczenia = await fillLsiEdoreczenia(page, EDORECZENIA);
if (edoreczenia.filled) await saveLsiForm(page);
const added = [];
for (const c of CONTACTS) {
  await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('long');
  if (
    await page.evaluate(
      (needle) => (document.body.innerText || '').includes(needle),
      `${c.imie} ${c.nazwisko}`,
    )
  )
    continue;
  await clickDodajContact();
  const filled = [];
  filled.push(await fillAny(['imie', 'imie_osoby_do_kontaktu'], c.imie));
  filled.push(
    await fillAny(['nazwisko', 'nazwisko_osoby_do_kontaktu'], c.nazwisko),
  );
  filled.push(
    await fillAny(
      ['telefon', 'telefon_osoby_do_kontaktu', 'nr_telefonu'],
      c.telefon,
    ),
  );
  filled.push(
    await fillAny(
      ['adres_email', 'email', 'adres_email_osoby_do_kontaktu'],
      c.email,
    ),
  );
  await saveLsiForm(page);
  added.push({ person: `${c.imie} ${c.nazwisko}`, filled });
}

const readback = await page.evaluate(() => ({
  tables: Array.from(document.querySelectorAll('table')).map((t) => ({
    rows: t.querySelectorAll('tbody tr').length,
    text: t.innerText.replace(/\s+/g, ' '),
  })),
}));
console.log(JSON.stringify({ deleted, edoreczenia, added, readback }, null, 2));
process.exit(0);
