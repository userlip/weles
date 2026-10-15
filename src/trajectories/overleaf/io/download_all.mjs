// Inventory and source download for every Overleaf project: Overleaf opened
// signed in (_shared/services/overleaf_google_sign_in.mjs), every dashboard
// project read (session/projects.mjs), and each project's source fetched
// through the zip endpoint Overleaf's own download menu uses, with the
// session's cookies, into OVERLEAF_SOURCES_DIR/<id>.zip. A JSON line per
// project gives the caller the id->title map; an index of every project and
// its outcome is written beside the zips. A download Overleaf refuses fails
// the run after every project was attempted.
//
// Usage: node src/trajectories/overleaf/io/download_all.mjs
// Env: OVERLEAF_SOURCES_DIR (required), HEADLESS=1 headless.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { openOverleaf } from '../../_shared/services/overleaf_google_sign_in.mjs';
import { overleafEvidence } from '../session/evidence.mjs';
import { dashboardProjects } from '../session/projects.mjs';

const INDENT = '  ';
// Sources land where the caller says; nothing under one person's home is assumed.
const OUT_DIR = statedText(['OVERLEAF_SOURCES_DIR'], 'the directory the project zips are written to');
mkdirSync(OUT_DIR, { recursive: true });
const evidence = overleafEvidence('overleaf_download_all');

const { s } = await openOverleaf({ label: 'overleaf_download_all' });
try {
  await evidence.shot(s, 'dashboard');
  const projects = await dashboardProjects(s.page);
  console.log(`[download_all] dashboard projects found: ${projects.length}`);
  const results = [];
  for (const project of projects) {
    const answer = await s.ctx.request.get(`https://www.overleaf.com/project/${project.id}/download/zip`);
    const result = { id: project.id, title: project.name, ok: answer.ok(), status: answer.status() };
    if (result.ok) {
      const zip = await answer.body();
      writeFileSync(join(OUT_DIR, `${project.id}.zip`), zip);
      result.bytes = zip.length;
    }
    results.push(result);
    console.log(`PROJECT ${JSON.stringify(result)}`);
  }
  writeFileSync(join(OUT_DIR, '_index.json'), JSON.stringify(results, null, INDENT));
  const refused = results.filter((result) => !result.ok);
  if (refused.length)
    throw new Error(
      `OVERLEAF_DOWNLOAD_REFUSED: ${refused.map((result) => `${result.id} answered HTTP ${result.status}`).join('; ')}; index ${join(OUT_DIR, '_index.json')}`,
    );
  console.log(`PASS: downloaded ${results.length} project sources into ${OUT_DIR}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
