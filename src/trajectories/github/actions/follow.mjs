// Follow a GitHub user through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the
// runner's.
//
// Env: TARGET_USER (required): the GitHub user to follow; nobody is
// followed by default.
//
// GitHub renders the follow control as a form posting to
// /users/follow?target=<name>, swapped for /users/unfollow once followed;
// the follow counts only when GitHub answers that POST for that user.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { responseAfterAction } from '../../_shared/page/settled.mjs';

const GITHUB_ORIGIN = 'https://github.com';
const TARGET_USER = statedText(
  ['TARGET_USER'],
  'the GitHub user to follow',
  'GITHUB_FOLLOW_TARGET_REQUIRED',
).replace(/^@/, '');
if (!TARGET_USER)
  throw new Error('TARGET_USER is "@" alone: it names no GitHub user');

await runAction({
  platform: 'github',
  action: 'follow',
  feedUrl: `${GITHUB_ORIGIN}/${encodeURIComponent(TARGET_USER)}`,
  banDetector: detectGitHubBanSignals,
  act: async (s) => {
    const followForm = s.page
      .locator('form[action*="/users/follow"]')
      .filter({ visible: true })
      .first();
    const unfollowForm = s.page
      .locator('form[action*="/users/unfollow"]')
      .filter({ visible: true })
      .first();
    if (await unfollowForm.count()) return `already following ${TARGET_USER}`;
    await followForm.waitFor({ state: 'visible' });
    const submit = followForm
      .locator('button[type="submit"], button:not([type]), input[type="submit"]')
      .filter({ visible: true })
      .first();
    await submit.waitFor({ state: 'visible' });
    const response = await responseAfterAction(
      s.page,
      (request) => {
        const url = new URL(request.url());
        return (
          request.method() === 'POST' &&
          url.origin === GITHUB_ORIGIN &&
          url.pathname === '/users/follow' &&
          url.searchParams.get('target')?.toLowerCase() ===
            TARGET_USER.toLowerCase()
        );
      },
      () => humanClickLocator(s.page, submit),
    );
    const responseError = await response.finished();
    if (responseError)
      throw new Error('GITHUB_FOLLOW_RESPONSE_FAILED', { cause: responseError });
    if (!response.ok())
      throw new Error(
        `GITHUB_FOLLOW_REFUSED: HTTP ${response.status()} at ${response.url()}`,
      );
    await unfollowForm.waitFor({ state: 'visible' });
    return `followed ${TARGET_USER}`;
  },
});
