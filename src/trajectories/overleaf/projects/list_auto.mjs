// The Overleaf dashboard as data: Overleaf opened signed in
// (_shared/services/overleaf_google_sign_in.mjs), every row loaded
// (session/projects.mjs), and each project's row read for its name, last
// update, owner and whether it sits under the archived or trashed filter.
//
// Env: OVERLEAF_LIST_INCLUDE (comma list of archived, trashed: the filtered
// rows kept; none unless named), OUT_JSONL (file the JSONL goes to; stdout
// when unset), HEADLESS=1 headless.
//
// Output: JSONL, one project per line, oldest first by last update; a
// newest-first table on stderr.
import { createWriteStream } from 'node:fs';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { openOverleaf } from '../../_shared/services/overleaf_google_sign_in.mjs';
import { overleafEvidence } from '../session/evidence.mjs';
import { dashboardProjects } from '../session/projects.mjs';

const INCLUDES = new Set(
  process.env.OVERLEAF_LIST_INCLUDE
    ? process.env.OVERLEAF_LIST_INCLUDE.split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : [],
);
const evidence = overleafEvidence('overleaf_list_auto');

/** One project's dashboard row: the largest ancestor of its link that links to no other project. */
function readRows(ids) {
  const text = (el) =>
    el && el.textContent.trim() ? el.textContent.trim() : null;
  return ids.map((id) => {
    const link = document.querySelector(`a[href*="/project/${id}"]`);
    const linksElsewhere = (node) =>
      Array.from(node.querySelectorAll('a[href*="/project/"]')).some(
        (other) => !other.getAttribute('href').includes(`/project/${id}`),
      );
    let row = link;
    while (row.parentElement && !linksElsewhere(row.parentElement))
      row = row.parentElement;
    const time = row.querySelector('time');
    return {
      id,
      name: text(link),
      lastUpdated: time
        ? time.getAttribute('datetime')
          ? time.getAttribute('datetime')
          : text(time)
        : null,
      owner: text(
        row.querySelector('[data-testid="project-owner"], .owner-name'),
      ),
      ownerEmail: text(
        row.querySelector('[data-testid="project-owner-email"]'),
      ),
      archived: Boolean(
        row.closest(
          '[data-testid="archived-projects"], [data-filter="archived"]',
        ),
      ),
      trashed: Boolean(
        row.closest(
          '[data-testid="trashed-projects"], [data-filter="trashed"]',
        ),
      ),
    };
  });
}

const { s } = await openOverleaf({ label: 'overleaf_list_auto' });
try {
  const projects = await dashboardProjects(s.page);
  console.log(`[list_auto] dashboard projects found: ${projects.length}`);
  const rows = (
    await s.page.evaluate(
      readRows,
      projects.map((project) => project.id),
    )
  )
    .filter(
      (row) =>
        (!row.archived || INCLUDES.has('archived')) &&
        (!row.trashed || INCLUDES.has('trashed')),
    )
    .sort((a, b) => String(a.lastUpdated).localeCompare(String(b.lastUpdated)));
  const out = process.env.OUT_JSONL
    ? createWriteStream(process.env.OUT_JSONL)
    : process.stdout;
  for (const row of rows) out.write(`${JSON.stringify(row)}\n`);
  if (out !== process.stdout) out.end();
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const updatedWidth = Math.max(
    ...rows.map((row) => String(row.lastUpdated).length),
  );
  process.stderr.write(
    `\n==== Overleaf dashboard (${rows.length} projects) ====\n`,
  );
  for (const row of [...rows].reverse())
    process.stderr.write(
      `  ${row.id.padEnd(idWidth)}  ${String(row.lastUpdated).padEnd(updatedWidth)}  ${row.name}\n`,
    );
  console.log(`PASS: ${rows.length} project(s) listed`);
} catch (error) {
  let failure = error;
  try {
    await evidence.shot(s, 'failure');
  } catch (shotError) {
    failure = new AggregateError(
      [error, shotError],
      `${error.message}; and the failure DOM was not kept: ${shotError.message}`,
    );
  }
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = exitStatusFor(failure);
} finally {
  await s.close();
}
