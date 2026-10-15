// Join a subreddit through the shared action runner: the account's fresh
// jar, the signed-in gate, the verdict and its record are the runner's.
//
// Env: SUBREDDIT (required; r/ prefix optional): the subreddit to join.
//
// The join is the subscribe toggle on old.reddit.com/r/<name>/: 'join'
// while not subscribed, 'leave' once subscribed.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { OLD_REDDIT, switchOn } from '../content/old_reddit.mjs';

const SUBREDDIT = statedText(['SUBREDDIT'], 'the subreddit to join').replace(
  /^\/?r\//,
  '',
);

await runAction({
  platform: 'reddit',
  action: 'join_sub',
  feedUrl: `${OLD_REDDIT}/r/${encodeURIComponent(SUBREDDIT)}/`,
  banDetector: detectRedditBanSignals,
  act: async (s) => {
    const joined = await switchOn(
      s.page,
      'span.fancy-toggle-button.subscribe-button',
      humanClickLocator,
    );
    return joined ? `already joined r/${SUBREDDIT}` : `joined r/${SUBREDDIT}`;
  },
});
