// Comment in a subreddit in the account character's own voice, through the
// shared action runner: the account's fresh jar and saved site storage, the
// signed-in gate, the character, the generated text, the verdict and its
// record are the runner's.
//
// Env: SUBREDDIT (required; r/ prefix optional): the subreddit the comment
// goes to. The comment answers the first post Reddit lists there that is
// neither locked nor archived; a feed that aggregates other subreddits is
// refused, since its filters remove new comments. TARGET_URL names a thread
// instead.
//
// Publishing and its proof are ./steps/publish.mjs.
import { detectRedditBanSignals } from '../../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../../_shared/action-runner.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { OLD_REDDIT } from '../../content/old_reddit.mjs';
import { threadAt } from './steps/reddit_json.mjs';
import { publishComment } from './steps/publish.mjs';

const SUBREDDIT = process.env.TARGET_URL
  ? undefined
  : statedText(['SUBREDDIT'], 'the subreddit the comment goes to').replace(
      /^\/?r\//,
      '',
    );

await runAction({
  platform: 'reddit',
  action: 'organic_comment',
  feedUrl: SUBREDDIT && `${OLD_REDDIT}/r/${encodeURIComponent(SUBREDDIT)}/`,
  surfaceLabel: (_acct, feed) => (SUBREDDIT ? `r/${SUBREDDIT}` : feed),
  pickPost: async (s) => {
    const thread = await threadAt(s.page, s.page.url());
    return { postTitle: thread.title, postBody: thread.body, url: thread.url };
  },
  submitComment: (s, text, post, acct) =>
    publishComment(s, acct, { thread: post.url, body: text }),
  banDetector: detectRedditBanSignals,
});
