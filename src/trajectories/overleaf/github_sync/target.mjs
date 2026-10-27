// Which Overleaf project a GitHub sync acts on: the stated project (its id,
// or text its dashboard title contains) and the repository it must be linked
// to, which decides between projects of the same title. The sync dialog is
// opened from the editor's integrations rail, and the project is the one
// whose dialog names that repository.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import {
  pageSettled,
  responseAfterAction,
} from '../../_shared/page/settled.mjs';
import { dashboardProjects } from '../session/projects.mjs';

const [, , projectArg, repoArg] = process.argv;
export const PROJECT = projectArg
  ? projectArg
  : statedText(
      ['OVERLEAF_PROJECT'],
      'the Overleaf project: its id, or text its dashboard title contains',
    );
export const REPO_SLUG = repoArg
  ? repoArg
  : statedText(
      ['OVERLEAF_GITHUB_REPO'],
      'owner/name of the GitHub repository the project is linked to',
    );
const HEX = /^[\dA-Fa-f]+$/;

/**
 * The projects the run may act on: every dashboard project whose id is the
 * stated project or whose title contains it, or, when the dashboard lists
 * none and the stated project is hexadecimal, that id itself (the run then
 * checks the project opens).
 */
export async function projectCandidates(page) {
  const wanted = PROJECT.toLowerCase();
  const candidates = (await dashboardProjects(page)).filter(
    ({ id, name }) => id === PROJECT || name.toLowerCase().includes(wanted),
  );
  if (candidates.length) {
    console.log(
      `[overleaf] ${candidates.length} project match(es); choosing by the GitHub link to ${REPO_SLUG}`,
    );
    return candidates;
  }
  if (HEX.test(PROJECT)) return [{ id: PROJECT, name: '(by id)' }];
  throw new Error(
    `OVERLEAF_PROJECT_NOT_FOUND: no dashboard project has the id or a title containing "${PROJECT}"`,
  );
}

/**
 * Opens the project's GitHub sync dialog from the integrations rail and waits
 * for Overleaf's own GitHub status answer; answers whether the dialog names
 * the linked repository.
 */
export async function openSyncDialog(page) {
  const rail = page.locator('#ide-rail-tabs-tab-integrations');
  await rail.waitFor({ state: 'visible' });
  await humanClickLocator(page, rail);
  await pageSettled(page);
  await responseAfterAction(
    page,
    (request) => new URL(request.url()).pathname.includes('/github-sync/'),
    () =>
      clickDescribed(
        page,
        'the GitHub card of the integrations panel, which syncs the project with a GitHub repository',
      ),
  );
  const dialog = page
    .locator('.modal-dialog')
    .filter({ visible: true })
    .first();
  await dialog.waitFor({ state: 'visible' });
  await pageSettled(page);
  return (await dialog.innerText())
    .toLowerCase()
    .includes(REPO_SLUG.toLowerCase());
}
