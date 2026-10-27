// One Overleaf GitHub sync run: Overleaf opened signed in (its cookies kept
// under OVERLEAF_AUTH_LABEL), every candidate project opened in turn, and the
// direction's `act` run on the one whose sync dialog names the linked
// repository. A run where no candidate is linked fails naming each candidate
// and why; every step leaves its DOM beside the run's recordings.
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { openOverleaf } from '../../_shared/services/overleaf_google_sign_in.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageShows } from '../../_shared/page/judged/seen.mjs';
import {
  pageSettled,
  responseAfterAction,
} from '../../_shared/page/settled.mjs';
import { overleafEvidence } from '../session/evidence.mjs';
import { REPO_SLUG, openSyncDialog, projectCandidates } from './target.mjs';

/**
 * Runs the sync `click` performs: Overleaf's own answer to it must succeed,
 * and the settled dialog must not report a conflict or a failed sync.
 */
export async function syncedBy(page, what, click) {
  const answer = await responseAfterAction(
    page,
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname.includes('/github-sync/'),
    click,
  );
  if (!answer.ok())
    throw new Error(
      `OVERLEAF_SYNC_REFUSED: the ${what} answered HTTP ${answer.status()}: ${await answer.text()}`,
    );
  await pageSettled(page);
  if (
    await pageShows(
      page,
      'Does the GitHub sync dialog report a merge conflict or a failed sync?',
    )
  )
    throw new Error(
      `OVERLEAF_SYNC_CONFLICT: Overleaf reports a conflict or a failure after the ${what}`,
    );
}

/** The sync run labelled `label`; `act(s, project)` performs the direction and answers what it did. */
export async function runGithubSync({ label, act }) {
  const evidence = overleafEvidence(label);
  const authLabel = statedText(
    ['OVERLEAF_AUTH_LABEL'],
    'the session store label the Overleaf session is kept under',
  );
  const { s } = await openOverleaf({ label, authLabel });
  try {
    const report = [];
    for (const project of await projectCandidates(s.page)) {
      await s.goto(`https://www.overleaf.com/project/${project.id}`);
      await pageSettled(s.page);
      if (
        !new URL(s.page.url()).pathname.startsWith(`/project/${project.id}`)
      ) {
        report.push(
          `${project.id} (${project.name}) did not open: Overleaf sent it to ${s.page.url()}`,
        );
        continue;
      }
      await evidence.shot(s, `editor_${project.id}`);
      if (!(await openSyncDialog(s.page))) {
        report.push(
          `${project.id} (${project.name}): its GitHub dialog does not name ${REPO_SLUG}`,
        );
        continue;
      }
      await evidence.shot(s, `sync_dialog_${project.id}`);
      const done = await act(s, project);
      await evidence.shot(s, `after_${project.id}`);
      console.log(`PASS: ${done}`);
      return;
    }
    await evidence.fail(
      s,
      'unlinked',
      `no candidate project is linked to ${REPO_SLUG}: ${report.join('; ')}`,
    );
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
}
