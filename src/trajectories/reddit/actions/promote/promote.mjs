// Comment on Reddit naming the character's promoted product, through the
// shared action runner: the account's fresh jar and saved site storage, the
// signed-in gate, the character and product, the generated text, the hold
// for review, the verdict and its record are the runner's. This run does
// not re-check whether the account may promote; the caller's lifecycle gate
// decides that.
//
// Env:
//   TARGET_URL or SUBREDDIT   the thread, or the subreddit whose first open
//                             post the comment answers (one is required)
//   PRODUCT_ID                the product, unless the character promotes one
//   VARIANT                   how the product is named (link or mention),
//                             unless the character's promotion config says
//   SVC_TEXT                  reviewed text to publish instead of generating
//   REQUIRE_APPROVAL=0        publish generated text without review
//
// Publishing and its proof are ../comment/steps/publish.mjs.
import { detectRedditBanSignals } from '../../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../../_shared/action-runner.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { OLD_REDDIT } from '../../content/old_reddit.mjs';
import { threadAt } from '../comment/steps/reddit_json.mjs';
import { publishComment } from '../comment/steps/publish.mjs';

const SUBREDDIT = process.env.TARGET_URL
  ? undefined
  : statedText(
      ['SUBREDDIT'],
      'the subreddit the comment goes to when TARGET_URL names no thread',
    ).replace(/^\/?r\//, '');

const pickThread = async (s) => {
  const thread = await threadAt(s.page, s.page.url());
  return { postTitle: thread.title, postBody: thread.body, url: thread.url };
};
const publish = (s, text, post, acct) =>
  publishComment(s, acct, { thread: post.url, body: text });

await runAction({
  platform: 'reddit',
  action: 'promote',
  feedUrl: SUBREDDIT && `${OLD_REDDIT}/r/${encodeURIComponent(SUBREDDIT)}/`,
  surfaceLabel: (_acct, feed) => (SUBREDDIT ? `r/${SUBREDDIT}` : feed),
  pickPost: pickThread,
  submitComment: publish,
  submitTargetedComment: publish,
  banDetector: detectRedditBanSignals,
});
