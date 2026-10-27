// Pull GitHub changes into the Overleaf project linked to a GitHub
// repository, through the shared sync run (github_sync/run.mjs): sign-in,
// the choice between same-titled projects by their linked repository, and
// the DOM evidence are the run's.
//
// Usage: node src/trajectories/overleaf/pull_github.mjs <PROJECT> <REPO_SLUG>
//   (or OVERLEAF_PROJECT / OVERLEAF_GITHUB_REPO); OVERLEAF_AUTH_LABEL names
//   the kept Overleaf session; HEADLESS=1 runs headless.
//
// A dialog waiting on a manual merge is continued; a dialog that says there
// is nothing new to pull leaves the project as it is; otherwise the pull
// runs, and counts once Overleaf answers it and reports no conflict.
import { clickDescribed, pageShows } from '../_shared/page/judged/seen.mjs';
import { REPO_SLUG } from './github_sync/target.mjs';
import { runGithubSync, syncedBy } from './github_sync/run.mjs';

await runGithubSync({
  label: 'overleaf_pull_github',
  act: async (s, project) => {
    if (
      await pageShows(
        s.page,
        'Does the GitHub sync dialog wait for confirmation that changes were merged manually?',
      )
    ) {
      await syncedBy(s.page, 'manual-merge continuation', () =>
        clickDescribed(
          s.page,
          'the button confirming the changes were merged manually and continuing',
        ),
      );
      return `continued the manual merge of ${REPO_SLUG} into ${project.id}`;
    }
    if (
      await pageShows(
        s.page,
        'Does the GitHub sync dialog say there are no new GitHub commits since the last merge?',
      )
    )
      return `${REPO_SLUG} has nothing new for ${project.id}`;
    await syncedBy(s.page, 'pull', () =>
      clickDescribed(
        s.page,
        'the button that pulls GitHub changes into Overleaf',
      ),
    );
    return `pulled GitHub changes from ${REPO_SLUG} into ${project.id}`;
  },
});
