// Comment on a Reddit thread with the caller's text, through the shared
// action runner: the account's fresh jar and saved site storage, the
// signed-in gate, the verdict and its record are the runner's.
//
// Env (both required; a comment is a publication under the account's name):
//   TARGET_URL     the thread, or a subreddit whose first open post is used
//   COMMENT_BODY   the comment, as the account's own words; text that
//                  announces automation gets the account shadowbanned
//
// Publishing and its proof are ./comment/steps/publish.mjs.
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { threadAt } from './comment/steps/reddit_json.mjs';
import { publishComment } from './comment/steps/publish.mjs';

const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the Reddit thread or subreddit the comment goes to',
);
const COMMENT_BODY = statedText(['COMMENT_BODY'], 'the comment to publish');

await runAction({
  platform: 'reddit',
  action: 'comment',
  banDetector: detectRedditBanSignals,
  act: async (s, { acct }) => {
    const { url } = await threadAt(s.page, TARGET_URL);
    return publishComment(s, acct, { thread: url, body: COMMENT_BODY });
  },
});
