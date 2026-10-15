// Create a GitHub repository under the account, through the shared action
// runner: the account's fresh jar, the signed-in gate, the verdict and its
// record are the runner's.
//
// Env (both required; they are public under the account's name):
//   REPO_NAME   the repository's name
//   REPO_DESC   its public description
//
// The name and description are typed into GitHub's /new form and read back
// before it is submitted; the repository is created when GitHub lands on
// github.com/<account>/<name>. No README, gitignore or license is added.
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled, submitAnswered } from '../../_shared/page/settled.mjs';
import { GITHUB_ORIGIN } from '../repository.mjs';

const REPO_NAME = statedText(
  ['REPO_NAME'],
  'the name of the repository to create',
);
if (!/^[\p{L}\p{N}_.-]+$/u.test(REPO_NAME))
  throw new Error(
    `REPO_NAME "${REPO_NAME}" holds characters GitHub does not take in a repository name; nothing was created`,
  );
const REPO_DESC = statedText(
  ['REPO_DESC'],
  'the public description of the repository',
);

await runAction({
  platform: 'github',
  action: 'create_repo',
  feedUrl: `${GITHUB_ORIGIN}/new`,
  banDetector: detectGitHubBanSignals,
  act: async (s, { acct }) => {
    const nameIn = s.page.locator('input#repository-name-input').first();
    await nameIn.waitFor({ state: 'visible' });
    await humanFill(s.page, nameIn, REPO_NAME);
    await pageSettled(s.page);
    const descIn = s.page.locator('input[name="Description"]').first();
    await humanFill(s.page, descIn, REPO_DESC);
    await pageSettled(s.page);
    const heldName = await nameIn.inputValue();
    const heldDescription = await descIn.inputValue();
    if (heldName !== REPO_NAME || heldDescription !== REPO_DESC)
      throw new Error(
        `repository form changed the requested name or description: name=${JSON.stringify(heldName)}, description=${JSON.stringify(heldDescription)}; nothing was submitted`,
      );
    await humanClickLocator(
      s.page,
      s.page
        .locator('button[type="submit"]')
        .filter({ hasText: 'Create repository' })
        .first(),
    );
    await submitAnswered(
      s.page,
      /github\.com\/new\b/,
      s.page
        .locator('.flash-error, [role="alert"], .error')
        .filter({ hasText: /\S/ })
        .first(),
    );
    const createdUrl = new URL(s.page.url());
    const [owner, name] = createdUrl.pathname.split('/').filter(Boolean);
    if (
      createdUrl.origin !== GITHUB_ORIGIN ||
      decodeURIComponent(owner) !== acct.username ||
      decodeURIComponent(name) !== REPO_NAME
    )
      throw new Error(`repo_not_created: GitHub left the browser at ${createdUrl}`);
    return `created ${acct.username}/${REPO_NAME}`;
  },
});
