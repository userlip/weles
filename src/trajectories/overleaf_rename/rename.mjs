// Rename Overleaf projects. For each "<projectId>=<new name>" argument the
// dashboard name is read, the project is renamed through the endpoint
// Overleaf's own rename dialog posts to (with the page's CSRF token), and the
// dashboard is read again to verify. Renaming does not touch the GitHub sync
// link. A rename that fails is reported with Overleaf's answer, and the run
// fails when any did.
//
// Usage: node src/trajectories/overleaf_rename/rename.mjs "<projectId>=New Name" [...]
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { openOverleaf } from '../_shared/services/overleaf_google_sign_in.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { dashboardProjects } from '../overleaf/session/projects.mjs';

const [, , ...ARGS] = process.argv;
const PAIRS = ARGS.map((arg) => {
  const [id, ...name] = arg.split('=');
  const wanted = name.join('=').trim();
  if (!/^[\dA-Fa-f]+$/.test(id.trim()) || !wanted)
    throw new Error(
      `OVERLEAF_RENAME_ARGUMENT: "${arg}" is not <projectId>=<new name>`,
    );
  return { id: id.trim(), name: wanted };
});
if (!PAIRS.length)
  throw new Error(
    'OVERLEAF_RENAME_ARGUMENT: name at least one "<projectId>=<new name>"',
  );

async function dashboardName(s, id) {
  await s.goto('https://www.overleaf.com/project');
  await pageSettled(s.page);
  const project = (await dashboardProjects(s.page)).find(
    (candidate) => candidate.id === id,
  );
  if (!project)
    throw new Error(
      `OVERLEAF_PROJECT_NOT_FOUND: the dashboard lists no project ${id}`,
    );
  return project.name;
}

async function rename(s, { id, name }) {
  const before = await dashboardName(s, id);
  const answer = await s.page.evaluate(
    async ({ projectId, newName }) => {
      const meta = document.querySelector('meta[name="ol-csrfToken"]');
      if (!meta)
        return {
          ok: false,
          status: null,
          text: 'the page carries no ol-csrfToken',
        };
      const response = await fetch(`/project/${projectId}/rename`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': meta.getAttribute('content'),
          Accept: 'application/json',
        },
        body: JSON.stringify({ newProjectName: newName }),
        credentials: 'include',
      });
      return {
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      };
    },
    { projectId: id, newName: name },
  );
  if (!answer.ok)
    throw new Error(
      `OVERLEAF_RENAME_REFUSED: ${id} answered ${answer.status}: ${answer.text}`,
    );
  const after = await dashboardName(s, id);
  if (after !== name)
    throw new Error(
      `OVERLEAF_RENAME_UNVERIFIED: ${id} is named ${JSON.stringify(after)} after the rename`,
    );
  return `${id}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
}

const { s } = await openOverleaf({ label: 'overleaf_rename' });
try {
  const failures = [];
  for (const pair of PAIRS)
    await rename(s, pair).then(
      (done) => console.log(`[rename] OK ${done}`),
      (error) => failures.push(error),
    );
  if (failures.length)
    throw new AggregateError(
      failures,
      failures.map((error) => error.message).join('; '),
    );
  console.log(`PASS: ${PAIRS.length} project(s) renamed`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
