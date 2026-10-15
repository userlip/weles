// Star a GitHub repository through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the
// runner's; the repository is the one the caller states (../repository.mjs).
//
// GitHub renders a repository's star control as a form posting to
// /<owner>/<repo>/star, re-rendered as /unstar once starred, so the form's
// action is what says whether the repository is starred.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { openSearchedRepository, repositoryTarget } from '../repository.mjs';

await runAction({
  platform: 'github',
  action: 'star',
  ...repositoryTarget('star'),
  banDetector: detectGitHubBanSignals,
  act: async (s) => {
    await openSearchedRepository(s);
    const unstarForm = s.page.locator('form[action$="/unstar"]');
    if (await unstarForm.filter({ visible: true }).count())
      return `already starred ${s.page.url()}`;
    const starBtn = s.page
      .locator('form[action$="/star"] button[type="submit"]')
      .filter({ visible: true })
      .first();
    await starBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, starBtn);
    await unstarForm.first().waitFor({ state: 'visible' });
    return `starred ${s.page.url()}`;
  },
});
