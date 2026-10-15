// Append text to a file in a GitHub repository and commit it through the
// web editor, via the shared action runner: the account's fresh jar, the
// signed-in gate, the verdict and its record are the runner's.
//
// Env (all required; a commit lands in a real repository's history under
// the account's name):
//   REPO_URL         the repository, as owner/name or its URL
//   COMMIT_BRANCH    the branch the commit lands on
//   FILE_PATH        the file the text is appended to
//   FILE_APPEND      the text appended, kept exactly as given
//   COMMIT_MESSAGE   the commit message
//
// The text is typed at the end of the file in GitHub's editor, the message
// replaces GitHub's default and is read back, and the commit counts as made
// when GitHub leaves the edit page. An edit page with no editor (a missing
// repository, branch or file, or no write access) is refused.
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled, submitAnswered } from '../../_shared/page/settled.mjs';
import { repositoryUrl } from '../repository.mjs';

const repoBase = repositoryUrl(
  statedText(
    ['REPO_URL'],
    'the GitHub repository (URL or owner/name) the commit goes to',
  ),
).replace(/\/$/, '');
const BRANCH = statedText(['COMMIT_BRANCH'], 'the branch the commit lands on');
const FILE_PATH = statedText(
  ['FILE_PATH'],
  'the repository file the commit appends to',
);
const COMMIT_MESSAGE = statedText(
  ['COMMIT_MESSAGE'],
  'the commit message the repository history records',
);
// Kept exactly as given: its leading and trailing newlines are part of it.
const FILE_APPEND = process.env.FILE_APPEND;
if (!FILE_APPEND?.trim())
  throw new Error(
    'FILE_APPEND is not set: the text the commit appends to the file; nothing is assumed',
  );
const EDIT_ROUTE = '/edit/';

await runAction({
  platform: 'github',
  action: 'commit',
  feedUrl: `${repoBase}${EDIT_ROUTE}${encodeURIComponent(BRANCH)}/${FILE_PATH}`,
  banDetector: detectGitHubBanSignals,
  act: async (s) => {
    const editor = s.page
      .locator(
        '.CodeMirror, [data-codemirror], textarea[name="value"], div[contenteditable="true"]',
      )
      .filter({ visible: true })
      .first();
    if (!(await editor.count()))
      throw new Error(
        `GITHUB_EDITOR_UNAVAILABLE: ${s.page.url()} shows no file editor (repository, branch or file missing, or no write access); nothing was committed`,
      );
    // Typed at the end of the file: direct DOM writes would bypass GitHub's
    // own change tracking.
    await humanClickLocator(s.page, editor);
    await s.page.keyboard.press('ControlOrMeta+End');
    await humanType(s.page, FILE_APPEND);
    await pageSettled(s.page);
    const openCommit = s.page
      .locator('button:has-text("Commit changes")')
      .filter({ visible: true })
      .first();
    await openCommit.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, openCommit);
    await pageSettled(s.page);
    const msgIn = s.page
      .locator(
        'textarea[id="commit-message-input"], textarea[aria-label*="ommit message"], dialog textarea[name="commit_message"]',
      )
      .filter({ visible: true })
      .first();
    if (!(await msgIn.count()))
      throw new Error(
        'COMMIT_MESSAGE_FIELD_UNAVAILABLE: no visible commit message input',
      );
    await humanClickLocator(s.page, msgIn);
    await s.page.keyboard.press('ControlOrMeta+A');
    await s.page.keyboard.press('Delete');
    await humanType(s.page, COMMIT_MESSAGE);
    // GitHub's default message must never replace or prefix the requested one.
    const held = await msgIn.inputValue();
    if (held !== COMMIT_MESSAGE)
      throw new Error(
        `commit message field holds ${JSON.stringify(held)}, not the message typed`,
      );
    await pageSettled(s.page);
    const confirmCommit = s.page
      .locator(
        'dialog button:has-text("Commit changes"), [role="dialog"] button:has-text("Commit changes"), .Box--overlay button:has-text("Commit changes")',
      )
      .filter({ visible: true })
      .first();
    await confirmCommit.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, confirmCommit);
    await submitAnswered(
      s.page,
      /\/edit\//,
      s.page
        .locator('.flash-error, [role="alert"]')
        .filter({ hasText: /\S/ })
        .first(),
    );
    const finalUrl = s.page.url();
    if (new URL(finalUrl).pathname.includes(EDIT_ROUTE))
      throw new Error(`commit_not_applied: still at ${finalUrl}`);
    return `committed to ${repoBase}/${FILE_PATH} on ${BRANCH}`;
  },
});
