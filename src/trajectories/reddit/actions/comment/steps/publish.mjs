// Publishing a comment on a Reddit thread and proving it can be seen.
//
// The comment is typed into the thread's top-level reply form on
// old.reddit.com (a plain <textarea name="text">; new Reddit keeps its
// composer in a collapsed shadow root) and submitted through real pointer
// events. It is published when the settled page shows it, any unhealthy
// signal read right after submit is cleared by the account's own listing,
// and it can be seen publicly; otherwise the run fails with the signal
// that says why. Every published comment is recorded for the next run's
// clean-session probe (deferred_verify.mjs), which this step runs first.
import { detectRedditBanSignals } from '../../../../../../dist/platforms/reddit/ban_signals.js';
import { humanType } from '../../../../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanScrollPage,
} from '../../../../../../dist/human/mouse.js';
import { banSignalOf } from '../../../../_shared/auth/ban-signal.mjs';
import { pageSettled } from '../../../../_shared/page/settled.mjs';
import { ownListingHas, readOwnHandle } from './reddit_json.mjs';
import { invisibleCommentSignal, publiclyVisible } from './visibility.mjs';
import {
  recordCommentForVerify,
  verifyPreviousComment,
} from './deferred_verify.mjs';

/** The id of the account's comment holding `body` on the settled page. */
async function postedCommentId(page, body) {
  await pageSettled(page);
  return page.evaluate((text) => {
    const authored = Array.from(
      document.querySelectorAll('div.thing[id^="thing_t1_"]'),
    ).find((thing) =>
      thing.querySelector('.usertext-body, .md')?.textContent.includes(text),
    );
    return authored?.id.replace('thing_t1_', '');
  }, body);
}

/** Publish `body` on `thread` (an old.reddit thread address ending in /). */
export async function publishComment(s, acct, { thread, body }) {
  await verifyPreviousComment(acct);
  const handle = await readOwnHandle(s.page);
  if (s.page.url() !== thread) {
    await s.goto(thread);
    await pageSettled(s.page);
  }
  // The post is read down before the composer is opened, as a reader does.
  await humanScrollPage(s.page, 'down');
  const composer = s.page
    .locator('textarea[name="text"]')
    .filter({ visible: true })
    .first();
  await composer.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, composer);
  await humanType(s.page, body);
  const submit = composer
    .locator('xpath=ancestor::form[1]')
    .locator(
      'button.save:enabled:not([aria-disabled="true"]), button[type="submit"]:enabled:not([aria-disabled="true"])',
    )
    .first();
  await submit.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, submit);
  const commentId = await postedCommentId(s.page, body);
  const afterSubmit = await banSignalOf(
    detectRedditBanSignals,
    s,
    'after submitting the comment',
  );
  if (!commentId && !(await ownListingHas(s.page, handle, body)))
    throw Object.assign(
      new Error(
        `REDDIT_COMMENT_UNCONFIRMED: ${thread} does not show the comment after submit and u/${handle}'s listing does not hold it`,
      ),
      { banSignal: afterSubmit },
    );
  if (!afterSubmit.healthy && !(await ownListingHas(s.page, handle, body)))
    throw Object.assign(
      new Error(
        `Reddit answered ${afterSubmit.signal} on submit and the comment is not in u/${handle}'s listing: ${JSON.stringify(afterSubmit.details)}`,
      ),
      { banSignal: afterSubmit },
    );
  if (!(await publiclyVisible(s, { thread, commentId, handle, body }))) {
    const banSignal = await invisibleCommentSignal(s, {
      handle,
      body,
      afterSubmit,
    });
    throw Object.assign(
      new Error(
        `the comment is not publicly visible: ${banSignal.signal} ${JSON.stringify(banSignal.details)}`,
      ),
      { banSignal },
    );
  }
  recordCommentForVerify(acct, {
    resolvedOldUrl: thread,
    postedCommentId: commentId,
    handle,
  });
  return commentId
    ? `commented on ${thread} (comment ${commentId}, publicly visible)`
    : `commented on ${thread} (publicly visible in u/${handle}'s listing)`;
}
