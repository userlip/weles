// Send a TikTok direct message, through the shared action runner: the
// account's fresh jar, the signed-in gate, the verdict and its record are the
// runner's.
//
// Env: RECIPIENT_HANDLE (required; @ optional) the username the DM goes to;
// DM_MESSAGE (required) the text, from a real account to a real person.
//
// The new-message control and its search are TikTok's own (data-e2e); the
// recipient is the search row naming exactly that username. A recipient
// whose settings refuse messages leaves no composer: the vision model reads
// why, and the run is refused by name. The message counts once the
// conversation shows it outside the composer.
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickOffered, pageShows } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { textShownOutsideEditors } from '../../_shared/page/shows.mjs';

const RECIPIENT = statedText(['RECIPIENT_HANDLE'], 'the TikTok username the DM goes to').replace(/^@/, '');
const MESSAGE = statedText(['DM_MESSAGE'], 'the text sent from a real account to a real person');

await runAction({
  platform: 'tiktok',
  action: 'dm',
  feedUrl: 'https://www.tiktok.com/messages',
  banDetector: detectTikTokBanSignals,
  act: async (s) => {
    const create = s.page.locator('[data-e2e="chat-create-new"]').filter({ visible: true }).first();
    await create.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, create);
    const search = s.page.locator('input[data-e2e="chat-create-new-search"]').filter({ visible: true }).first();
    await search.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, search);
    await humanType(s.page, RECIPIENT);
    const row = s.page.locator('[data-e2e*="search-user"]').filter({ has: s.page.getByText(RECIPIENT, { exact: true }), visible: true }).first();
    await row.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, row);
    await pageSettled(s.page);
    // Some flows confirm the chosen person before the conversation opens.
    if (await clickOffered(s.page, 'the button that starts the chat with the chosen person')) await pageSettled(s.page);
    const composer = s.page.locator('[data-e2e="message-input-textarea"], div[contenteditable="true"][role="textbox"]').filter({ visible: true }).first();
    if (!(await composer.count())) {
      if (await pageShows(s.page, `Does the page say @${RECIPIENT} does not accept messages from this account?`))
        throw new Error(`TIKTOK_DM_REFUSED_BY_RECIPIENT: @${RECIPIENT}'s settings do not accept messages from this account`);
      throw new Error(`TIKTOK_DM_COMPOSER_MISSING: the conversation with @${RECIPIENT} shows no message field at ${s.page.url()}`);
    }
    await humanClickLocator(s.page, composer);
    await humanType(s.page, MESSAGE);
    await s.page.keyboard.press('Enter');
    await pageSettled(s.page);
    if (!(await textShownOutsideEditors(s.page, MESSAGE)))
      throw new Error('TIKTOK_DM_UNCONFIRMED: the conversation does not show the message after sending');
    return `sent a message to @${RECIPIENT}`;
  },
});
