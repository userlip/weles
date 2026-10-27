// Send an X direct message, through the shared action runner: the account's
// fresh jar, the signed-in gate, the verdict and its record are the runner's.
//
// Env: RECIPIENT_HANDLE (required; @ optional) the handle the DM goes to;
// DM_MESSAGE (required) the text, from a real account to a real person.
//
// The compose page's people search takes the handle; the recipient is the
// typeahead row naming exactly that handle. The message counts once X's own
// answer to the send (its /dm/ API) succeeds and the conversation shows it.
import { humanType } from '../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { detectTwitterBanSignals } from '../../../../../dist/platforms/twitter/ban_signals.js';
import { runAction } from '../../../_shared/action-runner.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import {
  pageSettled,
  responseAfterAction,
} from '../../../_shared/page/settled.mjs';

const RECIPIENT = statedText(
  ['RECIPIENT_HANDLE'],
  'the X handle the DM goes to',
).replace(/^@/, '');
const MESSAGE = statedText(
  ['DM_MESSAGE'],
  'the text sent from a real account to a real person',
);

await runAction({
  platform: 'twitter',
  action: 'dm',
  feedUrl: 'https://x.com/messages/compose',
  banDetector: detectTwitterBanSignals,
  act: async (s) => {
    const search = s.page
      .locator('input[data-testid="searchPeople"]')
      .filter({ visible: true })
      .first();
    await search.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, search);
    await humanType(s.page, RECIPIENT);
    const row = s.page
      .locator('div[data-testid="TypeaheadUser"]')
      .filter({
        has: s.page.getByText(`@${RECIPIENT}`, { exact: true }),
        visible: true,
      })
      .first();
    await row.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, row);
    await pageSettled(s.page);
    const next = s.page
      .locator('button[data-testid="nextButton"]')
      .filter({ visible: true })
      .first();
    if (await next.isVisible()) {
      await humanClickLocator(s.page, next);
      await pageSettled(s.page);
    }
    const composer = s.page
      .locator('div[data-testid="dmComposerTextInput"]')
      .filter({ visible: true })
      .first();
    await composer.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, composer);
    await humanType(s.page, MESSAGE);
    const answer = await responseAfterAction(
      s.page,
      (request) =>
        request.method() === 'POST' &&
        new URL(request.url()).pathname.includes('/dm/'),
      () =>
        humanClickLocator(
          s.page,
          s.page
            .locator('[data-testid="dmComposerSendButton"]')
            .filter({ visible: true })
            .first(),
        ),
    );
    if (!answer.ok())
      throw new Error(
        `TWITTER_DM_REFUSED: X answered the message ${answer.status()}: ${await answer.text()}`,
      );
    await s.page
      .locator('[data-testid="messageEntry"]')
      .filter({ hasText: MESSAGE.trim() })
      .first()
      .waitFor({ state: 'visible' });
    return `sent a message to @${RECIPIENT}`;
  },
});
