// Fork a GitHub repository into the account, through the shared action
// runner: the account's fresh jar, the signed-in gate, the verdict and its
// record are the runner's.
//
// Env: REPO_URL (required): the repository to fork, as owner/repo or its URL.
//
// Whether the account already holds the fork is GitHub's own record of the
// account's repository of that name (its API says whether it is a fork and
// of what), not the words of the fork page. A fork is created when GitHub
// lands the browser on a repository under the account.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { submitAnswered } from '../../_shared/page/settled.mjs';
import { GITHUB_ORIGIN, repositoryUrl } from '../repository.mjs';
import { HTTP_NOT_FOUND } from '../../../worker/weles-api-server/routes/http-status.mjs';

const upstream = new URL(
  repositoryUrl(statedText(['REPO_URL'], 'the repository to fork')),
);
const [owner, name] = upstream.pathname.split('/').filter(Boolean);
if (!owner || !name)
  throw new Error(`REPO_URL ${upstream} names no owner/repository`);
const upstreamPath = `${owner}/${name}`;

/**
 * Whether `username` already holds a fork of the upstream under its name:
 * GitHub answers the account's repository of that name, or that it has none.
 */
async function heldFork(s, username) {
  const answer = await s.page
    .context()
    .request.get(`https://api.github.com/repos/${username}/${name}`);
  if (answer.status() === HTTP_NOT_FOUND) return false;
  if (!answer.ok())
    throw new Error(
      `GITHUB_FORK_LOOKUP: GitHub answered ${answer.status()} for ${username}/${name}: ${await answer.text()}`,
    );
  const repo = await answer.json();
  return (
    repo.fork === true &&
    repo.parent?.full_name?.toLowerCase() === upstreamPath.toLowerCase()
  );
}

await runAction({
  platform: 'github',
  action: 'fork',
  feedUrl: `${GITHUB_ORIGIN}/${upstreamPath}/fork`,
  banDetector: detectGitHubBanSignals,
  act: async (s, { acct }) => {
    if (await heldFork(s, acct.username))
      return `already forked ${upstreamPath}`;
    const submitBtn = s.page
      .locator('form[action$="/fork"] button[type="submit"]')
      .filter({ visible: true })
      .first();
    await submitBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, submitBtn);
    await submitAnswered(
      s.page,
      /\/fork$/,
      s.page
        .locator('.flash-error, [role="alert"]')
        .filter({ hasText: /\S/ })
        .first(),
    );
    const landed = new URL(s.page.url());
    const [landedOwner, landedRepo] = landed.pathname.split('/').filter(Boolean);
    if (
      landed.origin !== GITHUB_ORIGIN ||
      landedOwner?.toLowerCase() !== acct.username.toLowerCase() ||
      !landedRepo
    )
      throw new Error(
        `fork_not_created: GitHub left the browser at ${landed}, not a repository of ${acct.username}`,
      );
    return `forked ${upstreamPath} -> ${landed}`;
  },
});
