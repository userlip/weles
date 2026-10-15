// Trash every Overleaf project whose dashboard title is exactly the stated
// title: Overleaf opened signed in, every dashboard project read, and each
// match posted to the trash endpoint Overleaf's own dashboard uses, with the
// page's CSRF token. Trashed projects stay recoverable from Overleaf's Trash.
// The results are kept beside the run's recordings; a trash Overleaf refuses
// fails the run after every match was attempted.
//
// Usage: node src/trajectories/overleaf/io/trash_projects.mjs <exactTitle>
//   (or OVERLEAF_PROJECT_TITLE). Trashing is destructive: the exact title is
//   the caller's, never built in.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { openOverleaf } from '../../_shared/services/overleaf_google_sign_in.mjs';
import { dashboardProjects } from '../session/projects.mjs';

const INDENT = '  ';
const [, , titleArg] = process.argv;
const TARGET_TITLE = (titleArg ? titleArg : statedText(['OVERLEAF_PROJECT_TITLE'], 'the exact title of the projects to trash')).trim();

const { s } = await openOverleaf({ label: 'overleaf_trash_projects' });
try {
  const csrf = await s.page.locator('meta[name="ol-csrfToken"]').getAttribute('content');
  if (!csrf) throw new Error(`OVERLEAF_CSRF_MISSING: the dashboard at ${s.page.url()} carries no ol-csrfToken`);
  const projects = await dashboardProjects(s.page);
  const targets = projects.filter((project) => project.name === TARGET_TITLE);
  console.log(`[trash_projects] ${projects.length} projects on the dashboard; ${targets.length} titled "${TARGET_TITLE}"`);
  const results = [];
  for (const target of targets) {
    const answer = await s.ctx.request.post(`https://www.overleaf.com/project/${target.id}/trash`, {
      headers: { 'x-csrf-token': csrf, accept: 'application/json' },
    });
    results.push({ id: target.id, ok: answer.ok(), status: answer.status() });
    console.log(`[trash_projects] TRASH ${target.id} -> HTTP ${answer.status()}`);
  }
  const dir = runRecordingsDir('overleaf_trash_projects');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '_trash_results.json'), JSON.stringify(results, null, INDENT));
  const refused = results.filter((result) => !result.ok);
  if (refused.length)
    throw new Error(`OVERLEAF_TRASH_REFUSED: ${refused.map((result) => `${result.id} answered HTTP ${result.status}`).join('; ')}`);
  console.log(`PASS: trashed ${results.length} "${TARGET_TITLE}" project(s)`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
