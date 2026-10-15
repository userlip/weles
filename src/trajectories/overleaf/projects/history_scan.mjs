// Which figures each collaborator deleted, read from a project's native
// Overleaf history through the JSON API the history panel calls, with the
// signed-in session's cookies. The GitHub sync flattens authorship onto the
// project owner, so only this native record attributes a deletion.
//
// Endpoints (as Overleaf's own history panel calls them):
//   GET /project/<id>/changes/users          collaborators by id
//   GET /project/<id>/entities               the project's files
//   GET /project/<id>/updates?before=<ts>    save batches, page by page
//   GET /project/<id>/diff?from&to&pathname  a file's diff; each chunk names
//       the users who made it, so a deletion is attributable.
//
// Every .tex file's whole-history diff gives the deletions that stuck; with
// OVERLEAF_COLLABORATOR_EMAIL, each of that collaborator's save batches is
// diffed too, which catches figures they deleted that were later restored.
//
// Usage: node src/trajectories/overleaf/projects/history_scan.mjs <projectId>
//   (or OVERLEAF_PROJECT). Output: figure_deletions.json in the run's recordings.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { openOverleaf } from '../../_shared/services/overleaf_google_sign_in.mjs';

const INDENT = '  ';
const [, , projectArg] = process.argv;
const PROJECT = projectArg ? projectArg : statedText(['OVERLEAF_PROJECT'], 'the id of the project whose history is read');
const COLLABORATOR = process.env.OVERLEAF_COLLABORATOR_EMAIL;
// LaTeX that makes or names a figure.
const FIGURE = /\\begin\{figure|\\includegraphics|\\label\{fig:/;

async function historyJson(s, path) {
  const answer = await s.ctx.request.get(`https://www.overleaf.com/project/${PROJECT}${path}`, { headers: { Accept: 'application/json' } });
  if (!answer.ok()) throw new Error(`OVERLEAF_HISTORY_REFUSED: ${path} answered HTTP ${answer.status()}: ${await answer.text()}`);
  return answer.json();
}

/** Every save batch of the project, newest first, through the pages the history API links. */
async function allUpdates(s) {
  const updates = [];
  for (let before; ; ) {
    const page = await historyJson(s, `/updates${before ? `?before=${before}` : ''}`);
    updates.push(...page.updates);
    if (!page.nextBeforeTimestamp) return updates;
    before = page.nextBeforeTimestamp;
  }
}

/** The figure deletions in `file` between two versions, each with the users who made it. */
async function figureDeletions(s, file, from, to) {
  const { diff } = await historyJson(s, `/diff?from=${from}&to=${to}&pathname=${encodeURIComponent(file)}`);
  return diff
    .filter((chunk) => typeof chunk.d === 'string' && FIGURE.test(chunk.d))
    .map((chunk) => ({ file, from, to, users: chunk.meta.users, at: chunk.meta.end_ts, text: chunk.d }));
}

const { s } = await openOverleaf({ label: 'overleaf_history_scan' });
try {
  const users = await historyJson(s, '/changes/users');
  const names = new Map(users.map((user) => [user.id, [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email]));
  const { entities } = await historyJson(s, '/entities');
  const texFiles = entities.filter((entity) => entity.type === 'doc' && entity.path.endsWith('.tex')).map((entity) => entity.path.replace(/^\//, ''));
  const updates = await allUpdates(s);
  if (!updates.length) throw new Error(`OVERLEAF_HISTORY_EMPTY: project ${PROJECT} has no saved history`);
  const from = Math.min(...updates.map((update) => update.fromV));
  const to = Math.max(...updates.map((update) => update.toV));
  const stuck = [];
  for (const file of texFiles) stuck.push(...(await figureDeletions(s, file, from, to)));
  const collaborator = COLLABORATOR && users.find((user) => user.email === COLLABORATOR);
  if (COLLABORATOR && !collaborator) throw new Error(`OVERLEAF_COLLABORATOR_UNKNOWN: ${COLLABORATOR} is not a collaborator of ${PROJECT}`);
  const byCollaborator = [];
  if (collaborator)
    for (const update of updates.filter((candidate) => candidate.meta.users.some((user) => user.id === collaborator.id)))
      for (const file of texFiles)
        byCollaborator.push(
          ...(await figureDeletions(s, file, update.fromV, update.toV)).filter((deletion) => deletion.users.includes(collaborator.id)),
        );
  const dir = runRecordingsDir('overleaf_history_scan');
  mkdirSync(dir, { recursive: true });
  const report = join(dir, 'figure_deletions.json');
  writeFileSync(report, JSON.stringify({ project: PROJECT, users, texFiles, updates: updates.length, from, to, stuck, collaborator: COLLABORATOR, byCollaborator }, null, INDENT));
  const who = (ids) => ids.map((id) => names.get(id)).join(', ');
  for (const deletion of stuck) console.log(`[history_scan] STUCK ${deletion.file} by [${who(deletion.users)}] at ${deletion.at}: ${deletion.text.replace(/\s+/g, ' ')}`);
  for (const deletion of byCollaborator)
    console.log(`[history_scan] ${COLLABORATOR} ${deletion.file} v${deletion.from}->${deletion.to}: ${deletion.text.replace(/\s+/g, ' ')}`);
  console.log(`PASS: ${stuck.length} figure deletion(s) stuck across ${texFiles.length} .tex file(s); report ${report}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
