// Read-only row count for NEW NCBR section 4.1. Does not close page.

import { chromium } from 'playwright';
import { humanIdlePause } from '../../../../../dist/human/mouse.js';

const endpoint = (await import('#ncbr-settings')).cdpEndpoint();
const SECTION_URL = (await import('#ncbr-settings')).sectionUrl('4_1');

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) {
  console.log(JSON.stringify({ error: 'NO_PAGE' }));
  process.exit(1);
}

await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' });
await humanIdlePause('long');
// Every row's text is reported; which people it names is read from the rows,
// not checked against names written here.
const out = await page.evaluate(() => ({
  url: location.href,
  tables: Array.from(document.querySelectorAll('table')).map((table, i) => ({
    i,
    rows: table.querySelectorAll('tbody tr').length,
    text: Array.from(table.querySelectorAll('tbody tr')).map((r) =>
      r.innerText.trim().replace(/\s+/g, ' '),
    ),
  })),
}));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
