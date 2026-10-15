import { humanFill } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';

// The issue comment box: the Primer/React composer, and the classic shell
// some repositories and views still ship.
const COMMENT_BOX =
  '[data-testid="comment-composer"] textarea, textarea[aria-labelledby="comment-composer-heading"], textarea#new_comment_field, textarea[name="comment[body]"]';

/**
 * The issue a comment on this page answers: its title and its opening
 * post. A page that shows no issue title is not an issue and is refused.
 */
export async function githubIssuePost(s) {
  await pageSettled(s.page);
  const title = s.page
    .locator('bdi.js-issue-title, .js-issue-title, [data-testid="issue-title"]')
    .first();
  if (!(await title.count()))
    throw new Error(`GITHUB_NOT_AN_ISSUE: ${s.page.url()} shows no issue title`);
  const opening = s.page.locator('.markdown-body').first();
  return {
    postTitle: await title.innerText(),
    postBody: (await opening.count()) ? await opening.innerText() : undefined,
    url: s.page.url(),
  };
}

/**
 * Comment on the issue the page shows. The comment counts once GitHub
 * answers its write (the Primer flow's POST to /_graphql, the classic
 * flow's POST to /issues/<n>/comments) with success and clears the box.
 */
export async function githubSubmitIssueComment(s, text) {
  const box = s.page.locator(COMMENT_BOX).filter({ visible: true }).first();
  await box.waitFor({ state: 'visible' });
  await humanFill(s.page, box, text);
  // The Primer composer's primary button is type="button" inside
  // [data-testid="save-button-tooltip"]; the classic shell's is a submit.
  const submit = s.page
    .locator(
      '[data-testid="save-button-tooltip"] button[data-variant="primary"]:not([disabled]), [data-testid="comment-composer"] button[data-variant="primary"]:not([disabled]), form.js-new-comment-form button[type="submit"]:not([disabled])',
    )
    .filter({ visible: true })
    .first();
  await submit.waitFor({ state: 'visible' });
  // Armed before the click, so the write's answer is not missed: the box
  // clears as soon as React updates, before the answer lands.
  const written = s.page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' &&
      /(\/_graphql$|\/issues\/\d+\/comments)/.test(r.url()),
  );
  await humanClickLocator(s.page, submit);
  const answer = await written;
  if (!answer.ok())
    throw new Error(
      `GITHUB_COMMENT_REFUSED: ${answer.url()} answered ${answer.status()}: ${await answer.text()}`,
    );
  await s.page.waitForFunction(
    (selector) => {
      const field = document.querySelector(selector);
      return !field || !field.value;
    },
    COMMENT_BOX,
    { polling: 'raf' },
  );
}
