import {
  contextRead,
  ownListingHas,
  publicAboutStatus,
} from './reddit_json.mjs';
import { HTTP_NOT_FOUND, HTTP_OK } from '../../../../../worker/weles-api-server/routes/http-status.mjs';

/**
 * Whether the comment can be seen publicly right after submit. With its id,
 * the comment's own permalink JSON (/r/<sub>/comments/<post>/<slug>/<id>/.json)
 * is read: it carries a fresh comment at once, where the thread listing lags
 * by hours. Without one, the account's public comment listing is read.
 */
export async function publiclyVisible(s, { thread, commentId, handle, body }) {
  if (commentId) {
    const { status, body: text } = await contextRead(
      s,
      `${thread}${commentId}/.json`,
    );
    if (status !== HTTP_OK)
      throw new Error(
        `REDDIT_PERMALINK_UNREAD: ${thread}${commentId}/.json answered ${status}: ${text}`,
      );
    const [, replies] = JSON.parse(text);
    const node = replies?.data?.children?.find((c) => c.data?.id === commentId);
    return node?.kind === 't1' && node.data.author === handle;
  }
  const listing = `https://old.reddit.com/user/${encodeURIComponent(handle)}/comments/.json?sort=new`;
  const { status, body: text } = await contextRead(s, listing);
  if (status !== HTTP_OK)
    throw new Error(`REDDIT_LISTING_UNREAD: ${listing} answered ${status}: ${text}`);
  return text.includes(body);
}

/**
 * Why a comment the account posted is not publicly visible:
 *   - the account's public about.json answers 404: the account is hidden
 *     from signed-out readers (shadowban);
 *   - the comment is in the account's own signed-in listing but not public:
 *     Reddit holds it back (a new account cooling, when the profile is
 *     public, or the subreddit's filter);
 *   - it is in neither: Reddit dropped it, under the signal read right
 *     after submit when that one was not healthy.
 * Every read is Reddit's own; one that fails throws.
 */
export async function invisibleCommentSignal(s, { handle, body, afterSubmit }) {
  const aboutStatus = await publicAboutStatus(s, handle);
  const details = { real_handle: handle, public_about_status: aboutStatus };
  if (aboutStatus === HTTP_NOT_FOUND)
    return {
      signal: 'shadowban_suspected',
      healthy: false,
      details: { ...details, reason: 'the profile is hidden from signed-out readers' },
    };
  if (await ownListingHas(s.page, handle, body))
    return {
      signal: 'shadowban_suspected',
      healthy: false,
      details: {
        ...details,
        reason:
          aboutStatus === HTTP_OK
            ? 'the comment is in the account listing but not public: Reddit is holding back a new account'
            : 'the comment is in the account listing but not public: the subreddit filtered it',
      },
    };
  if (!afterSubmit.healthy) return afterSubmit;
  return {
    signal: 'shadowban_suspected',
    healthy: false,
    details: {
      ...details,
      reason: 'the comment is in neither the public view nor the account listing',
    },
  };
}
