// Deletes rows from premium sections 5.1/5.2 when standalone project validation requires emptiness.
// UI-only, no direct API writes. Never submits and never closes the page.

import { chromium } from 'playwright';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../dist/human/mouse.js';
import {
  chooseDeleteInRowMenu,
  confirmDeletion,
} from '../../../_shared/ncbr/row_menu.mjs';

const endpoint = (await import('#ncbr-settings')).cdpEndpoint();
const PROJ = (await import('#ncbr-settings')).sectionBase();
const IDS = {
  5.1: (await import('#ncbr-settings')).sectionId('5_1'),
  5.2: (await import('#ncbr-settings')).sectionId('5_2'),
};

const SECTION = process.env.SECTION;
if (!IDS[SECTION])
  throw new Error(`SECTION must be one of ${Object.keys(IDS).join(', ')}`);

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) {
  console.log(JSON.stringify({ error: 'NO_PAGE' }));
  process.exit(1);
}

await page.goto(PROJ + IDS[SECTION], { waitUntil: 'domcontentloaded' });
await humanIdlePause('long');
await (await import('#ncbr-cookie-notice')).dismissCookieNotice(page); // allow-raw-playwright: neutralise cookie banner

async function rowCount() {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll('table tbody tr')).filter((r) =>
        r.querySelector('button[aria-label="overflow-options"]'),
      ).length,
  );
}

async function openFirstRowMenu() {
  const menu = page
    .locator('table tbody tr')
    .filter({ has: page.locator('button[aria-label="overflow-options"]') })
    .first()
    .locator('button[aria-label="overflow-options"]')
    .first();
  if ((await menu.count()) === 0) throw new Error('no data row');
  await humanClickLocator(page, menu);
  await humanIdlePause('deliberate');
}

if (process.env.DIAG) {
  await openFirstRowMenu();
  const menu = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[role="menuitem"], .MuiMenuItem-root'),
    )
      .map((e) => e.textContent.trim())
      .filter(Boolean),
  );
  console.log(
    JSON.stringify({ section: SECTION, rows: await rowCount(), menu }, null, 2),
  );
  process.exit(0);
}

const deleted = [];
while ((await rowCount()) > 0) {
  await openFirstRowMenu();
  await chooseDeleteInRowMenu(page);
  await confirmDeletion(page);
  await humanIdlePause('long');
  deleted.push(SECTION);
}

console.log(
  JSON.stringify(
    { section: SECTION, deleted: deleted.length, rows: await rowCount() },
    null,
    2,
  ),
);
process.exit(0);
