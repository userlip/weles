// Follow a Reddit user through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the
// runner's.
//
// Env (one is required; nobody is followed by default):
//   TARGET_USER   the user to follow (u/ prefix optional)
//   SUBREDDIT     a subreddit whose newest post author is followed when
//                 TARGET_USER is unset (r/ prefix optional)
//
// Reddit's follow is the friend toggle on the user's profile subreddit
// (old.reddit.com/r/u_<name>/): '+ friends' while not followed, '- friends'
// once followed.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { OLD_REDDIT, switchOn } from '../content/old_reddit.mjs';

const TARGET_USER = process.env.TARGET_USER?.trim().replace(/^\/?u\//, '');
const SUBREDDIT = TARGET_USER
  ? undefined
  : statedText(
      ['SUBREDDIT'],
      'the subreddit whose newest author is followed when TARGET_USER is unset',
    ).replace(/^\/?r\//, '');

const profileSubreddit = (user) =>
  `${OLD_REDDIT}/r/u_${encodeURIComponent(user)}/`;

/** The newest post author of SUBREDDIT, as Reddit's own listing names it. */
async function newestAuthor(page) {
  const listing = await page.evaluate(
    async (url) => {
      const answer = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      return {
        ok: answer.ok,
        status: answer.status,
        body: await answer.text(),
      };
    },
    `${OLD_REDDIT}/r/${encodeURIComponent(SUBREDDIT)}/new/.json?raw_json=1`,
  );
  if (!listing.ok)
    throw new Error(
      `REDDIT_LISTING_REFUSED: r/${SUBREDDIT}/new answered ${listing.status}: ${listing.body}`,
    );
  const posts = JSON.parse(listing.body).data?.children;
  const author = Array.isArray(posts)
    ? posts
        .map((child) => child.data?.author)
        .find(
          (name) =>
            name && name !== '[deleted]' && !/^AutoModerator$/i.test(name),
        )
    : undefined;
  if (!author)
    throw new Error(
      `REDDIT_NO_AUTHOR: r/${SUBREDDIT}/new lists no post by a live author to follow`,
    );
  return author;
}

await runAction({
  platform: 'reddit',
  action: 'follow',
  feedUrl: TARGET_USER
    ? profileSubreddit(TARGET_USER)
    : `${OLD_REDDIT}/r/${encodeURIComponent(SUBREDDIT)}/new/`,
  banDetector: detectRedditBanSignals,
  act: async (s) => {
    let author = TARGET_USER;
    if (!author) {
      author = await newestAuthor(s.page);
      await s.goto(profileSubreddit(author));
      await pageSettled(s.page);
    }
    const followed = await switchOn(
      s.page,
      'span.fancy-toggle-button.toggle',
      humanClickLocator,
    );
    return followed
      ? `already following u/${author}`
      : `now following u/${author}`;
  },
});
