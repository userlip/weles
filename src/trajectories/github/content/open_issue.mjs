// Open an issue on a GitHub repository, through the shared action runner:
// the account's fresh jar, the signed-in gate, the verdict and its record
// are the runner's.
//
// Env (all required; an issue is a publication under the account's name):
//   REPO_URL      the repository, as owner/repo or its URL
//   ISSUE_TITLE   the issue's title
//   ISSUE_BODY    the issue's body
//
// The issue is written on the repository's blank issue form, typed with
// real keystrokes, and counts as opened when GitHub lands on the new
// issue's own page. A repository that offers no blank issue form is refused.
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled, submitAnswered } from '../../_shared/page/settled.mjs';
import { repositoryUrl } from '../repository.mjs';

const ISSUE_TITLE = statedText(['ISSUE_TITLE'], "the issue's title");
const ISSUE_BODY = statedText(['ISSUE_BODY'], "the issue's body");
const repoBase = repositoryUrl(
  statedText(['REPO_URL'], 'the repository the issue is opened on'),
);

await runAction({
  platform: 'github',
  action: 'open_issue',
  feedUrl: `${repoBase}/issues/new`,
  banDetector: detectGitHubBanSignals,
  act: async (s) => {
    const titleLoc = s.page
      .locator(
        'input[name="issue[title]"], input#issue_title, input[aria-label="Add a title"], input[placeholder="Title"]',
      )
      .filter({ visible: true })
      .first();
    const bodyLoc = s.page
      .locator(
        'textarea[name="issue[body]"], textarea#issue_body, textarea[name="description"], textarea[aria-label="Markdown value"], textarea[placeholder*="description"]',
      )
      .filter({ visible: true })
      .first();
    if (!(await titleLoc.count()) || !(await bodyLoc.count()))
      throw new Error(
        `issue_form_not_found: ${s.page.url()} offers no blank issue form with a title and a body`,
      );
    await humanFill(s.page, titleLoc, ISSUE_TITLE);
    await humanFill(s.page, bodyLoc, ISSUE_BODY);
    await pageSettled(s.page);
    const submitBtn = s.page
      .locator(
        '[data-testid="create-issue-button"]:not([disabled]), button.btn-primary[type="submit"]:not([disabled])',
      )
      .filter({ visible: true })
      .first();
    await submitBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, submitBtn);
    await submitAnswered(
      s.page,
      /\/issues\/new\b/,
      s.page
        .locator('.flash-error, [role="alert"]')
        .filter({ hasText: /\S/ })
        .first(),
    );
    const finalUrl = s.page.url();
    if (!/\/issues\/\d+$/.test(new URL(finalUrl).pathname))
      throw new Error(
        `issue_not_submitted: GitHub left the browser at ${finalUrl}`,
      );
    return `opened ${finalUrl}`;
  },
});
