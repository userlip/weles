// The explicit modes of the 10.4 sync: listing what the act autocomplete
// offers for the searches the caller states, adding one vetted act alone, and
// syncing every vetted row. Each prints its result and exits. Which table row
// is about an act is judged by the model (table.mjs), never by phrases.
import { humanIdlePause } from '../../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../../dist/human/keyboard.js';
import {
  statedBudget,
  statedText,
} from '../../../../_shared/inputs/stated.mjs';
import { actSubject, staleActs, targets } from './source.mjs';

export async function runModes({ page, SECTION_URL, table, form }) {
  const {
    tableState,
    rowAboutSubject,
    openRowAbout,
    deleteRowAbout,
    clickAdd,
  } = table;
  const { fillTextLikeField, setLegalAct, saveRow, fillLegalActForm } = form;
  if (process.env.DIAG_ADD) {
    await clickAdd();
    const input = page.locator('input[name="akt_prawny"]').first();
    await input.waitFor({ state: 'visible' });
    const searches = statedText(
      ['DIAG_SEARCHES'],
      'the searches to type into the act autocomplete, separated by |',
    )
      .split('|')
      .filter(Boolean);
    const results = [];
    for (const search of searches) {
      await humanFill(page, input, search);
      await humanIdlePause('deliberate');
      const options = (
        await page
          .locator("[role='listbox'] [role='option'], [role='option']")
          .allTextContents()
      )
        .map((text) => text.trim())
        .filter(Boolean);
      results.push({ search, options });
    }
    console.log(JSON.stringify({ diagAdd: results }, null, 2));
    process.exit(0);
  }

  if (process.env.ADD_ONLY_ACT !== undefined) {
    const act = statedText(
      ['ADD_ONLY_ACT'],
      'the vetted act to add alone, as the markdown source names it',
    );
    const row = targets.find((candidate) => candidate.act === act);
    if (!row)
      throw new Error(
        `ADD_ONLY_ACT names no vetted act of the markdown source: ${act}; the source has ${targets.map((candidate) => candidate.act).join(' | ')}`,
      );
    console.log(
      JSON.stringify({
        stage: 'start',
        row: { act: row.act, len: row.formJustificationLength },
      }),
    );
    await clickAdd();
    console.log(JSON.stringify({ stage: 'opened' }));
    const picked = await setLegalAct(row);
    console.log(JSON.stringify({ stage: 'picked', picked }));
    // Serialized into the page, so it carries its own pattern: the form's
    // justification field, under its own name or nested under a row.
    const justFill = await fillTextLikeField(
      (el) => /(^|\.)uzasadnienie$/.test(el.name),
      row.formJustification,
    );
    console.log(JSON.stringify({ stage: 'filled', justFill }));
    if (!justFill.filled)
      throw new Error(
        `10.4 justification for ${row.act} not filled: ${JSON.stringify(justFill)}`,
      );
    const formState = await page.evaluate(() => ({
      visibleFields: Array.from(document.querySelectorAll('input, textarea'))
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({
          name: el.name,
          value: el.value,
          len: el.value.length,
          role: el.getAttribute('role'),
          invalid: el.getAttribute('aria-invalid'),
        })),
      saves: Array.from(document.querySelectorAll('button'))
        .filter((button) => button.innerText.trim() === 'Zapisz')
        .map((button) => ({
          disabled: button.disabled,
          visible: !!button.getClientRects().length,
        })),
      errors: Array.from(
        document.querySelectorAll('[aria-invalid="true"], .Mui-error'),
      )
        .map((el) =>
          el.hasAttribute('name')
            ? el.getAttribute('name')
            : el.textContent.trim(),
        )
        .filter(Boolean),
    })); // allow-raw-playwright: read add-form state before save
    console.log(JSON.stringify({ stage: 'formState', formState }));
    const save = await saveRow();
    console.log(JSON.stringify({ stage: 'save', save }));
    await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' }); // allow-raw-playwright: return to 10.4 table
    await humanIdlePause('long');
    const readback = await tableState();
    console.log(JSON.stringify({ stage: 'readback', readback }, null, 2));
    process.exit(0);
  }

  if (process.env.SYNC_ALL) {
    const before = await tableState();
    const deleted = [];
    for (const stale of staleActs) {
      deleted.push({ stale, ...(await deleteRowAbout(stale)) });
      await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' }); // allow-raw-playwright: return to 10.4 table after delete attempt
      await humanIdlePause('long');
    }
    // A caller resuming an interrupted sync states how many vetted rows are
    // already done; without it the sync starts from the first.
    const syncTargets =
      process.env.START_AT === undefined
        ? targets
        : targets.slice(
            statedBudget('START_AT', 'how many vetted rows are already synced'),
          );
    const results = [];
    for (const row of syncTargets) {
      const present = await rowAboutSubject(actSubject(row));
      if (present) {
        await openRowAbout(actSubject(row));
        results.push({
          act: row.act,
          action: 'edit',
          row: present.text,
          ...(await fillLegalActForm(row)),
        });
      } else {
        await clickAdd();
        results.push({
          act: row.act,
          action: 'add',
          ...(await fillLegalActForm(row)),
        });
      }
      await page.goto(SECTION_URL, { waitUntil: 'domcontentloaded' }); // allow-raw-playwright: return to 10.4 table after row save
      await humanIdlePause('long');
    }
    const readback = await tableState();
    const found = [];
    for (const row of targets) {
      if (await rowAboutSubject(actSubject(row))) found.push(row.act);
    }
    const staleRemaining = [];
    for (const stale of staleActs) {
      const remaining = await rowAboutSubject(stale);
      if (remaining) staleRemaining.push({ stale, row: remaining.text });
    }
    console.log(
      JSON.stringify(
        {
          expected: targets.map((row) => ({
            act: row.act,
            formJustificationLength: row.formJustificationLength,
          })),
          before,
          deleted,
          results,
          readback,
          found,
          foundCount: found.length,
          staleRemaining,
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }
}
