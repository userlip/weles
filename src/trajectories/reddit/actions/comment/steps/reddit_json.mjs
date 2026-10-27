// Reads of Reddit's own JSON. Each read through the page goes out signed in
// as the account; a refused read throws with Reddit's status and body.
// Reddit's own listing order and page size decide which posts and comments
// are seen; no count or pick window is chosen here.
import { onOldReddit } from '../../../content/old_reddit.mjs';
import { pageSettled } from '../../../../_shared/page/settled.mjs';

/** One signed-in JSON read through the page; Reddit's refusal throws. */
async function signedInJson(page, url) {
  const answer = await page.evaluate(async (address) => {
    const response = await fetch(address, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  }, url);
  if (!answer.ok)
    throw new Error(
      `REDDIT_READ_REFUSED: ${url} answered ${answer.status}: ${answer.body}`,
    );
  return JSON.parse(answer.body);
}

/** The signed-in account's handle; a session Reddit does not know throws. */
export async function readOwnHandle(page) {
  const me = await signedInJson(page, '/api/me.json');
  const name = me.data?.name;
  if (!name)
    throw new Error(
      `REDDIT_SIGNED_OUT: /api/me.json names no account for this session: ${JSON.stringify(me)}`,
    );
  return name;
}

/** Whether the account's own newest comments, read signed in, contain `body`. */
export async function ownListingHas(page, handle, body) {
  const listing = await signedInJson(
    page,
    `/user/${encodeURIComponent(handle)}/comments/.json?sort=new`,
  );
  const comments = listing.data?.children;
  return (
    Array.isArray(comments) &&
    comments.some(
      (c) => typeof c.data?.body === 'string' && c.data.body.includes(body),
    )
  );
}

/**
 * One JSON read through the session's request context: status plus body text.
 * The context carries the account's cookies, so the certificate is verified:
 * a TLS-intercepting proxy is refused rather than handed the session.
 */
export async function contextRead(s, url) {
  const resp = await s.page.context().request.get(url, {
    headers: { Accept: 'application/json' },
  });
  return { status: resp.status(), body: await resp.text() };
}

/** The HTTP status of the account's public about.json, read without cookies. */
export async function publicAboutStatus(s, handle) {
  const { status } = await contextRead(
    s,
    `https://old.reddit.com/user/${encodeURIComponent(handle)}/about.json`,
  );
  return status;
}

const THREAD = /\/comments\/[a-z\d]+\//i;

/**
 * The thread a comment goes to, with the title and text of its post: the
 * thread `url` names, or, for a subreddit listing, the first post Reddit
 * lists there that is neither locked nor archived. A listing whose posts all
 * belong to other subreddits is an aggregate feed and refused; so is one
 * with no open post. The page is moved to the old.reddit address first, so
 * its signed-in JSON reads are same-origin.
 */
export async function threadAt(page, url) {
  const address = onOldReddit(url).replace(/\/?(\?.*)?$/, '/');
  if (new URL(page.url()).origin !== new URL(address).origin) {
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await pageSettled(page);
  }
  if (THREAD.test(address)) {
    const [post] = await signedInJson(page, `${address}.json?raw_json=1`);
    const op = post.data?.children?.[0]?.data;
    if (!op)
      throw new Error(`REDDIT_THREAD_EMPTY: ${address} answered no post`);
    return { url: address, title: op.title, body: op.selftext };
  }
  const listing = await signedInJson(page, `${address}.json?raw_json=1`);
  const listed = listing.data?.children;
  if (!Array.isArray(listed))
    throw new Error(`REDDIT_LISTING_EMPTY: ${address} answered no posts`);
  const posts = listed.map((c) => c.data).filter(Boolean);
  const subreddit = address.match(/\/r\/(?<name>[^/]+)\//)?.groups.name;
  const own = subreddit
    ? posts.filter(
        (p) => p.subreddit?.toLowerCase() === subreddit.toLowerCase(),
      )
    : posts;
  if (posts.length && !own.length)
    throw new Error(
      `REDDIT_AGGREGATE_FEED: r/${subreddit} lists only posts of other subreddits, so it is an aggregate feed whose filters remove new comments; name one subreddit`,
    );
  const open = own.find((p) => !p.locked && !p.archived);
  if (!open)
    throw new Error(
      `REDDIT_NO_OPEN_POST: ${address} lists no post that is neither locked nor archived`,
    );
  return {
    url: onOldReddit(`https://www.reddit.com${open.permalink}`),
    title: open.title,
    body: open.selftext,
  };
}
