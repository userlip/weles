// Push the Overleaf project's current state to its linked GitHub repository,
// through the shared sync run (github_sync/run.mjs): sign-in, the choice
// between same-titled projects by their linked repository, and the DOM
// evidence are the run's. Non-destructive to the Overleaf source.
//
// Usage: node src/trajectories/overleaf/push_github.mjs <PROJECT> <REPO_SLUG>
//   (or OVERLEAF_PROJECT / OVERLEAF_GITHUB_REPO); OVERLEAF_COMMIT_MESSAGE is
//   the commit message (the caller's words, never a sentence written here);
//   OVERLEAF_AUTH_LABEL names the kept Overleaf session; HEADLESS=1 headless.
//
// The push opens a commit dialog; the push runs when its message is
// confirmed, and counts once Overleaf answers it and reports no conflict.
import { humanFill } from '../../../dist/human/keyboard.js';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { REPO_SLUG } from './github_sync/target.mjs';
import { runGithubSync, syncedBy } from './github_sync/run.mjs';

const COMMIT_MESSAGE = statedText(
  ['OVERLEAF_COMMIT_MESSAGE'],
  'the commit message the GitHub repository records for this sync',
);

await runGithubSync({
  label: 'overleaf_push_github',
  act: async (s, project) => {
    await clickDescribed(
      s.page,
      'the button that pushes Overleaf changes to GitHub',
    );
    await pageSettled(s.page);
    const message = s.page
      .locator('.modal-dialog textarea')
      .filter({ visible: true })
      .first();
    await message.waitFor({ state: 'visible' });
    await humanFill(s.page, message, COMMIT_MESSAGE);
    const held = await message.inputValue();
    if (held !== COMMIT_MESSAGE)
      throw new Error(
        `OVERLEAF_COMMIT_MESSAGE_MISMATCH: the message field holds ${JSON.stringify(held)}`,
      );
    await syncedBy(s.page, 'push', () =>
      clickDescribed(
        s.page,
        'the button that syncs the commit message to GitHub',
      ),
    );
    return `pushed ${project.id} to GitHub (${REPO_SLUG})`;
  },
});
