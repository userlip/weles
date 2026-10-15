// What a page shows at one step of a trajectory, kept with the run: its
// address, title, text and every control the browser renders, with each
// control's role, link, placeholder and whether it is disabled. The record
// is written to the run's own recordings (beside its screenshots and video),
// not to the log, so account details on the page stay with the run; the log
// names the file and what it holds.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { pageSettled } from '../page/settled.mjs';

const INDENT = '  ';

/** The page's state, read in the page. */
function readState() {
  const textOf = (el) =>
    ('innerText' in el ? el.innerText : el.textContent)
      .replace(/\s+/g, ' ')
      .trim();
  const controls = Array.from(
    document.querySelectorAll(
      'button, [role="button"], a, [role="menuitem"], input, textarea, select, [aria-label]',
    ),
  )
    .filter((el) => el.checkVisibility())
    .map((el) => ({
      text: textOf(el),
      label: el.getAttribute('aria-label'),
      role: el.getAttribute('role') ? el.getAttribute('role') : el.tagName.toLowerCase(),
      href: el.getAttribute('href'),
      placeholder: el.getAttribute('placeholder'),
      disabled:
        el.disabled === true || el.getAttribute('aria-disabled') === 'true',
    }));
  return {
    url: location.href,
    title: document.title,
    text: textOf(document.body),
    controls,
  };
}

/**
 * Read the settled page and keep its state as `<step>.page.json` in the
 * recordings of `run`. Resolves the state.
 */
export async function recordPageState(page, run, step) {
  await pageSettled(page);
  const state = await page.evaluate(readState);
  const dir = runRecordingsDir(run);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${step}.page.json`);
  writeFileSync(file, JSON.stringify(state, null, INDENT));
  console.log(
    `[${run}] ${step}: ${state.controls.length} controls, ${state.text.length} characters of text -> ${file}`,
  );
  return state;
}
