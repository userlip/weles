// Create Overleaf projects by importing GitHub repositories: Overleaf opened
// signed in once (_shared/services/overleaf_google_sign_in.mjs), then for each
// owner/name: New Project -> Import from GitHub (found by the vision model in
// whatever language Overleaf renders) -> the import control in the row whose
// GitHub link is exactly that repository -> the new /project/<id>. A
// repository Overleaf cannot see, or whose import fails, is recorded and the
// batch continues; the run fails when any import did. Each step leaves its
// DOM beside the run's recordings.
//
// Usage: node src/trajectories/overleaf/projects/import_github.mjs <owner/name> [...]
//   (or OVERLEAF_GITHUB_REPO for one).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import {
  clickDescribed,
  clickOffered,
} from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { openOverleaf } from '../../_shared/services/overleaf_google_sign_in.mjs';
import { overleafEvidence } from '../session/evidence.mjs';

const INDENT = '  ';
const [, , ...ARGS] = process.argv;
const REPO_SLUGS = ARGS.length
  ? ARGS
  : [
      statedText(
        ['OVERLEAF_GITHUB_REPO'],
        'owner/name of the GitHub repository to import',
      ),
    ];
for (const slug of REPO_SLUGS)
  if (!/^[^/]+\/[^/]+$/.test(slug))
    throw new Error(`OVERLEAF_IMPORT_ARGUMENT: "${slug}" is not owner/name`);
const evidence = overleafEvidence('overleaf_import_github');
const ON_PROJECT = /\/project\/(?<id>[\dA-Fa-f]+)(?:[/?#]|$)/;

async function importOne(s, slug) {
  const tag = slug.replace(/\W/g, '_');
  await s.goto('https://www.overleaf.com/project');
  await pageSettled(s.page);
  await clickDescribed(s.page, 'the button that creates a new project');
  await clickDescribed(
    s.page,
    'the menu entry that imports a project from GitHub',
  );
  await pageSettled(s.page);
  // The picker lists every repository Overleaf can see as a row with its
  // GitHub link; only the row linking to exactly this repository is used.
  const row = s.page
    .locator('tr', {
      has: s.page.locator(
        `a[href$="github.com/${slug}"], a[href*="github.com/${slug}/"]`,
      ),
    })
    .first();
  if (!(await row.count())) {
    await evidence.shot(s, `absent_${tag}`);
    throw new Error(
      `OVERLEAF_IMPORT_REPO_UNSEEN: the GitHub picker lists no ${slug}; Overleaf's GitHub grant does not reach its owner`,
    );
  }
  const rowImport = row.locator('button').filter({ visible: true }).first();
  if (!(await rowImport.count()))
    throw new Error(
      `OVERLEAF_IMPORT_CONTROL_MISSING: the picker row of ${slug} holds no button`,
    );
  await rowImport.scrollIntoViewIfNeeded();
  await humanClickLocator(s.page, rowImport);
  await pageSettled(s.page);
  // Overleaf lands on the new project, or asks to confirm the import first.
  if (!ON_PROJECT.test(new URL(s.page.url()).pathname)) {
    if (!(await clickOffered(s.page, 'the button that confirms the import')))
      throw new Error(
        `OVERLEAF_IMPORT_UNANSWERED: importing ${slug} neither opened a project nor asked to confirm, at ${s.page.url()}`,
      );
    await s.page.waitForURL((url) => ON_PROJECT.test(url.pathname));
  }
  await evidence.shot(s, `done_${tag}`);
  return new URL(s.page.url()).pathname.match(ON_PROJECT).groups.id;
}

const { s } = await openOverleaf({ label: 'overleaf_import_github' });
try {
  const results = [];
  for (const slug of REPO_SLUGS)
    await importOne(s, slug).then(
      (id) => {
        results.push({ slug, id, ok: true });
        console.log(
          `[import_github] IMPORTED ${slug} -> https://www.overleaf.com/project/${id}`,
        );
      },
      (error) => results.push({ slug, ok: false, error: error.message }),
    );
  const dir = runRecordingsDir('overleaf_import_github');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, '_import_results.json'),
    JSON.stringify(results, null, INDENT),
  );
  const failed = results.filter((result) => !result.ok);
  if (failed.length)
    throw new Error(
      `OVERLEAF_IMPORT_FAILED: ${failed.map((result) => `${result.slug}: ${result.error}`).join('; ')}`,
    );
  console.log(`PASS: imported ${results.length} repo(s)`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
