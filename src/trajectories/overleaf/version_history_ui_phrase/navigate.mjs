// Getting to the history panel: opening the project by id or title, and
// opening the version history. Signing in is the shared opener's
// (_shared/services/overleaf_google_sign_in.mjs).
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { dashboardProjects } from '../session/projects.mjs';
import { isId, target } from './settings.mjs';

/** Opens the stated project (by id, or the first dashboard project whose title contains it); answers its id. */
export async function resolveAndOpenProject(s) {
  if (isId) {
    await s.goto(`https://www.overleaf.com/project/${target}`);
    await pageSettled(s.page);
    return target;
  }
  const wanted = target.toLowerCase();
  const match = (await dashboardProjects(s.page)).find(({ name }) =>
    name.toLowerCase().includes(wanted),
  );
  if (!match)
    throw new Error(
      `OVERLEAF_PROJECT_NOT_FOUND: no dashboard project title contains "${target}"`,
    );
  await s.goto(`https://www.overleaf.com/project/${match.id}`);
  await pageSettled(s.page);
  return match.id;
}

/** Opens the project's version history; the vision model finds its control in whatever language Overleaf renders. */
export async function openHistoryUi(s) {
  await clickDescribed(
    s.page,
    "the control that shows the project's version history (a History button, or the menu entry for it)",
  );
  await pageSettled(s.page);
  return 'described';
}
