// Watch a GitHub repository at a stated level, through the shared action
// runner: the account's fresh jar, the signed-in gate, the verdict and its
// record are the runner's; the repository is the one the caller states
// (../repository.mjs).
//
// Env: WATCH_LEVEL (or SVC_TEXT), required: the entry of GitHub's watch
// menu to choose, as GitHub labels it; no level is picked here.
//
// The watch control opens a menu of levels whose chosen entry is checked;
// the choice is taken when the control's label changes, and a flash error
// is GitHub refusing it.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageCondition } from '../../_shared/page/settled.mjs';
import { openSearchedRepository, repositoryTarget } from '../repository.mjs';

const WATCH_LEVEL = statedText(
  ['WATCH_LEVEL', 'SVC_TEXT'],
  "the entry of GitHub's watch menu to choose, as GitHub labels it",
  'GITHUB_WATCH_LEVEL_REQUIRED',
);

await runAction({
  platform: 'github',
  action: 'watch_repo',
  ...repositoryTarget('watch'),
  banDetector: detectGitHubBanSignals,
  act: async (s) => {
    await openSearchedRepository(s);
    const watchBtn = s.page
      .locator('button[aria-label^="Watch"]')
      .filter({ visible: true })
      .first();
    await watchBtn.waitFor({ state: 'visible' });
    const ariaBefore = await watchBtn.getAttribute('aria-label');
    await humanClickLocator(s.page, watchBtn);
    const levelEntry = s.page
      .locator('label, button, [role="menuitemradio"]')
      .filter({ hasText: WATCH_LEVEL })
      .filter({ visible: true })
      .first();
    if (!(await levelEntry.count()))
      throw new Error(
        `GITHUB_WATCH_LEVEL_UNOFFERED: the watch menu offers no entry "${WATCH_LEVEL}"`,
      );
    if ((await levelEntry.getAttribute('aria-checked')) === 'true')
      return `already watching at "${WATCH_LEVEL}" (${ariaBefore})`;
    await humanClickLocator(s.page, levelEntry);
    const result = await pageCondition(
      s.page,
      (before) => {
        const visible = (node) =>
          node.getClientRects().length > 0 &&
          getComputedStyle(node).visibility === 'visible';
        const button = Array.from(
          document.querySelectorAll('button[aria-label^="Watch"]'),
        ).find(visible);
        const label = button?.getAttribute('aria-label');
        if (label && label !== before) return { state: 'changed', label };
        const error = Array.from(
          document.querySelectorAll('.flash-error'),
        ).find(visible);
        if (error?.textContent?.trim())
          return { state: 'refused', label, message: error.textContent.trim() };
        return null;
      },
      ariaBefore,
    );
    if (result.state === 'refused')
      throw new Error(
        `GITHUB_WATCH_REFUSED: ${result.message}; before=${ariaBefore}; after=${result.label}`,
      );
    return `watch control shows ${result.label}`;
  },
});
