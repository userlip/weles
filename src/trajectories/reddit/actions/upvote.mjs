// Upvote a Reddit post through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the
// runner's.
//
// Env (one is required; nothing is upvoted by default):
//   TARGET_URL   a post or listing on reddit.com
//   SUBREDDIT    a subreddit whose listing is used when TARGET_URL is unset
//                (r/ prefix optional)
//
// The vote is cast on old.reddit.com, on the first post of the page that is
// neither archived nor stickied and not yet voted on, and counts when that
// same post (by its data-fullname) shows the upvoted arrow.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { OLD_REDDIT, onOldReddit } from '../content/old_reddit.mjs';

const SUBREDDIT = process.env.TARGET_URL
  ? undefined
  : statedText(
      ['SUBREDDIT'],
      'the subreddit whose listing is upvoted in when TARGET_URL is unset',
    ).replace(/^\/?r\//, '');

await runAction({
  platform: 'reddit',
  action: 'upvote',
  feedUrl: SUBREDDIT && `${OLD_REDDIT}/r/${encodeURIComponent(SUBREDDIT)}/`,
  banDetector: detectRedditBanSignals,
  act: async (s) => {
    const oldAddress = onOldReddit(s.page.url());
    if (s.page.url() !== oldAddress) {
      await s.goto(oldAddress);
      await pageSettled(s.page);
    }
    const thing = s.page
      .locator('div.thing[data-fullname]:not(.archived):not(.stickied)')
      .filter({ has: s.page.locator('div.midcol.unvoted div.arrow.up') })
      .first();
    await thing.waitFor({ state: 'visible' });
    const fullname = await thing.getAttribute('data-fullname');
    await humanClickLocator(s.page, thing.locator('div.midcol.unvoted div.arrow.up').first());
    await s.page
      .locator(
        `div.thing[data-fullname="${fullname}"] div.midcol.likes div.arrow.upmod`,
      )
      .first()
      .waitFor({ state: 'visible' });
    return `upvoted ${fullname}`;
  },
});
