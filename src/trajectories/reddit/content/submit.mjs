import { runAction } from '../../_shared/action-runner.mjs';
import { humanType, humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { fitsField } from '../../_shared/page/fits.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';

const ACTION = process.env.POST_PROMOTE === '1' ? 'post_promote' : 'post';
// The community the post goes to is the caller's; r/ before it is accepted.
const SUBREDDIT = statedText(
  ['SUBREDDIT'],
  'the subreddit the post is submitted to',
  'REDDIT_SUBREDDIT_REQUIRED',
).replace(/^r\//, '');
if (!SUBREDDIT)
  throw new Error('SUBREDDIT is "r/" alone: it names no subreddit');

await runAction({
  platform: 'reddit',
  action: ACTION,
  // Use old.reddit.com for submission — same deterministic
  // textarea/button.save pattern as reddit_comment.mjs.
  feedUrl: `https://old.reddit.com/r/${encodeURIComponent(SUBREDDIT)}/submit?selftext=true`,
  banDetector: detectRedditBanSignals,
  surfaceLabel: `r/${SUBREDDIT}`,
  // The title is the first sentence and the body the rest; a text with no
  // sentence end is all title. The title field's own maxlength decides
  // whether it fits; no title length is chosen here.
  submitPost: async (s, text) => {
    const sentence = text.match(/^(?<title>[^.]*)\.(?<body>[\s\S]*)$/);
    const title = (sentence ? sentence.groups.title : text).trim();
    const body = (sentence ? sentence.groups.body : '').trim();
    const titleIn = s.page
      .locator('input[name="title"], textarea[name="title"]')
      .filter({ visible: true })
      .first();
    await titleIn.waitFor({ state: 'visible' });
    await fitsField(titleIn, title, 'the Reddit post title');
    await humanFill(s.page, titleIn, title);
    const bodyIn = s.page
      .locator('textarea[name="text"]')
      .filter({ visible: true })
      .first();
    if (body) {
      // A body with nowhere to go would post the title alone.
      if (!(await bodyIn.count()))
        throw new Error(
          `r/${SUBREDDIT}'s submit form offers no text field for the post body`,
        );
      await humanClickLocator(s.page, bodyIn);
      await humanType(s.page, body);
    }
    // old.reddit's Submit button is button.btn within the submit form.
    const submitBtn = s.page
      .locator(
        'form#newlink button.btn[type="submit"], button.btn:has-text("submit")',
      )
      .filter({ visible: true })
      .first();
    await submitBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, submitBtn);
    await s.page.waitForFunction(
      (sub) =>
        /\/comments\//.test(location.pathname) &&
        new RegExp(`/r/${sub}/`, 'i').test(location.pathname),
      SUBREDDIT,
    );
  },
});
