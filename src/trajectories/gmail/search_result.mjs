// Reading a Gmail search result on a signed-in Gmail page: whether the page
// is signed-in Gmail at all, the result list (sender, subject, date, snippet
// of every matching thread), and the bodies of the first `open` threads.
// A thread that cannot be opened fails with its cause.
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';

const GMAIL_HOST = 'mail.google.com';

/** Gmail's search address for `query` in the mailbox at `base` (its /mail/u/<n>/ address). */
export function gmailSearchUrl(base, query) {
  return `${base}#search/${encodeURIComponent(query)}`;
}

/** Whether the page is signed-in Gmail: Gmail's own host with its search field. */
export async function signedInGmail(page) {
  for (;;) {
    if (new URL(page.url()).hostname !== GMAIL_HOST) return false;
    if (await page.locator('input[name="q"]').count()) return true;
    await pageSettled(page);
  }
}

/** Print the result list and, when `open` is a count, that many thread bodies. */
export async function printSearchResult(page, open, log) {
  const rows = await page.evaluate(() =>
    // allow-raw-playwright: read-only DOM text scrape of the result list, no synthetic interaction
    Array.from(document.querySelectorAll('tr.zA'), (row) => {
      const sender = row.querySelector('.yW span[email], .yW span, .zF');
      const date = row.querySelector('.xW span[title], .xW span');
      return {
        from: sender
          ? sender.getAttribute('email')
            ? sender.getAttribute('email')
            : sender.textContent.trim()
          : null,
        subject: row.querySelector('.bog')?.textContent.trim(),
        date: date
          ? date.getAttribute('title')
            ? date.getAttribute('title')
            : date.textContent.trim()
          : null,
        snippet: row.querySelector('.y2')?.textContent.trim(),
      };
    }),
  );
  log(`PASS: signed in. ${rows.length} threads match the query`);
  console.log('================ THREAD LIST ================');
  for (const row of rows) {
    console.log(`- ${row.date} | ${row.from}`);
    console.log(`     SUBJ: ${row.subject}`);
    console.log(`     SNIP: ${row.snippet}`);
  }
  if (!open) return rows;
  console.log('================ THREAD BODIES ================');
  for (const index of Array(Math.min(open, rows.length)).keys()) {
    await humanClickLocator(page, page.locator('tr.zA').nth(index));
    await page
      .locator('.a3s, div[role="listitem"] .ii')
      .first()
      .waitFor({ state: 'visible' });
    const body = await page.evaluate(() => ({
      // allow-raw-playwright: read-only DOM text scrape of an opened email body, no synthetic interaction
      subject: document.querySelector('h2.hP')?.textContent.trim(),
      text: Array.from(document.querySelectorAll('.a3s'), (block) =>
        block.innerText.trim(),
      )
        .filter(Boolean)
        .join('\n---\n'),
    }));
    console.log(`\n>>> THREAD: ${body.subject}`);
    console.log(body.text);
    await page.goBack({ waitUntil: 'domcontentloaded' }); // allow-raw-playwright: back to the result list
    await page.locator('tr.zA').first().waitFor({ state: 'visible' });
  }
  return rows;
}
