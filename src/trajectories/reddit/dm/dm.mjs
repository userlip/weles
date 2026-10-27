// Send a Reddit private message through old.reddit's compose form, through
// the shared action runner: the account's fresh jar, the signed-in gate (on
// old.reddit's front page; the compose page renders signed out too), the
// verdict and its record are the runner's. The legacy private message works
// from the kept cookies; chat.reddit.com needs its own device attestation.
//
// Env (all required): RECIPIENT_HANDLE (u/ optional), DM_SUBJECT, DM_MESSAGE.
//
// The form posts to /api/compose and is answered with the jQuery calls its
// page runs; a refused field is a call on the element carrying Reddit's own
// error code as a class (`.error.<CODE>`), which fails the run.
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { confirmedFill } from '../../_shared/page/confirmed-fill.mjs';
import { responseAfterAction } from '../../_shared/page/settled.mjs';

const ERROR_CALL = /\.error\.(?<code>[A-Z_]+)/g;
const RECIPIENT = statedText(
  ['RECIPIENT_HANDLE'],
  'the Reddit username the message goes to',
)
  .replace(/^u\//, '')
  .replace(/^\//, '');
const SUBJECT = statedText(
  ['DM_SUBJECT'],
  'the subject line of the message a real person receives',
);
const MESSAGE = statedText(
  ['DM_MESSAGE'],
  'the text sent from a real account to a real person',
);

await runAction({
  platform: 'reddit',
  action: 'dm',
  feedUrl: 'https://old.reddit.com/',
  banDetector: detectRedditBanSignals,
  act: async (s) => {
    await s.goto(
      `https://old.reddit.com/message/compose/?to=${encodeURIComponent(RECIPIENT)}`,
    );
    const to = s.page
      .locator('input#send_to')
      .filter({ visible: true })
      .first();
    await to.waitFor({ state: 'visible' });
    // A recipient field holding another name would send the message to them.
    if ((await to.inputValue()).toLowerCase() !== RECIPIENT.toLowerCase())
      await confirmedFill(s.page, to, RECIPIENT, 'the Reddit recipient field');
    await humanClickLocator(
      s.page,
      s.page.locator('input#subject').filter({ visible: true }).first(),
    );
    await humanType(s.page, SUBJECT);
    await humanClickLocator(
      s.page,
      s.page
        .locator(
          'textarea#message-text, form#compose-message textarea[name="text"]',
        )
        .filter({ visible: true })
        .first(),
    );
    await humanType(s.page, MESSAGE);
    const send = s.page
      .locator('form#compose-message button[type="submit"]')
      .filter({ visible: true })
      .first();
    await send.waitFor({ state: 'visible' });
    const answer = await responseAfterAction(
      s.page,
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname.endsWith('/api/compose'),
      () => humanClickLocator(s.page, send),
    );
    const body = await answer.text();
    if (!answer.ok())
      throw new Error(
        `REDDIT_DM_HTTP_ERROR: ${answer.status()} from ${answer.url()}: ${body}`,
      );
    const refused = [
      ...new Set(
        [...body.matchAll(ERROR_CALL)].map((match) => match.groups.code),
      ),
    ];
    if (refused.length)
      throw new Error(
        `REDDIT_DM_REFUSED: reddit answered ${refused.join(', ')}: ${body}`,
      );
    return `sent a private message to u/${RECIPIENT}`;
  },
});
