// Section 9.2 cleanup: delete the non-environmental HarmBench own indicator.
// UI-only; never submits.

import { chromium } from 'playwright';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../../../dist/human/mouse.js';
import {
  chooseDeleteInRowMenu,
  confirmDeletion,
} from '../../../../_shared/ncbr/row_menu.mjs';

const endpoint = (await import('#ncbr-settings')).cdpEndpoint();
const SECTION_URL = (await import('#ncbr-settings')).sectionUrl('9_2');
// The indicator's own name, as the application states it.
const NEEDLE = 'Redukcja attack success rate na HarmBench';

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) {
  console.log(JSON.stringify({ error: 'NO_PAGE' }, null, 2));
  process.exit(1);
}

await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' }); // allow-raw-playwright: UI navigation to authenticated draft section
await humanIdlePause('long');
await (await import('#ncbr-cookie-notice')).dismissCookieNotice(page); // allow-raw-playwright: neutralise cookie banner only

async function rows() {
  return page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr'))
      .filter((r) => r.querySelector('button[aria-label="overflow-options"]'))
      .map((r) => r.innerText.replace(/\s+/g, ' ').trim());
  }); // allow-raw-playwright: read table state
}

const before = await rows();
const targetBefore = before.find((row) => row.startsWith(NEEDLE));
if (!targetBefore) {
  console.log(
    JSON.stringify(
      {
        deleted: false,
        note: 'HarmBench indicator already absent',
        beforeCount: before.length,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const targetRow = page
  .locator('table tbody tr')
  .filter({ hasText: NEEDLE })
  .first();
const overflowButton = targetRow
  .locator('button[aria-label="overflow-options"]')
  .first();
if (!(await overflowButton.count()))
  throw new Error('target HarmBench indicator row not found');
await humanClickLocator(page, overflowButton);
await humanIdlePause('deliberate');

if (process.env.DIAG_MENU) {
  const menu = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[role="menuitem"], .MuiMenuItem-root'),
    )
      .map((e) => e.textContent.trim())
      .filter(Boolean),
  );
  console.log(JSON.stringify({ targetBefore, menu }, null, 2));
  process.exit(0);
}

await chooseDeleteInRowMenu(page);
if (!(await confirmDeletion(page)))
  throw new Error('delete confirmation button not found');
await humanIdlePause('long');

const after = await rows();
const stillPresent = after.some((row) => row.startsWith(NEEDLE));
console.log(
  JSON.stringify(
    {
      deleted: !stillPresent,
      beforeCount: before.length,
      afterCount: after.length,
      targetBefore,
      stillPresent,
    },
    null,
    2,
  ),
);
process.exit(stillPresent ? 2 : 0);
