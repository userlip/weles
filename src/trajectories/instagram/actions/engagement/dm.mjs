// Send one Instagram direct message through the shared action runner: the
// account's fresh jar, the signed-in gate, the verdict and its record are
// the runner's. The run opens Instagram's new-message dialog, picks the
// stated recipient, types the stated message into the chat's composer and
// counts it sent once the conversation shows it outside the composer.
//
// Env: RECIPIENT_HANDLE and DM_MESSAGE (required).
import { humanType } from '../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { detectInstagramBanSignals } from '../../../../../dist/platforms/instagram/ban_signals.js';
import { runAction } from '../../../_shared/action-runner.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { textShownOutsideEditors } from '../../../_shared/page/shows.mjs';
import { clickDescribed, clickOffered } from '../../../_shared/page/judged/seen.mjs';

const RECIPIENT = statedText(['RECIPIENT_HANDLE'], 'the Instagram handle the DM goes to');
const MESSAGE = statedText(['DM_MESSAGE'], 'the text sent from a real account to a real person');

await runAction({
  platform: 'instagram',
  action: 'dm',
  feedUrl: 'https://www.instagram.com/direct/new/',
  banDetector: detectInstagramBanSignals,
  act: async (s) => {
    // Some cohorts show a notifications upsell first; it is dismissed when shown.
    await clickOffered(s.page, 'the button that dismisses the notifications prompt without turning them on');
    const search = s.page
      .locator(
        'div[role="dialog"] input[name="queryBox"], div[role="dialog"] input[placeholder*="Search" i], div[role="dialog"] input[aria-label*="Search" i]',
      )
      .filter({ visible: true })
      .first();
    await search.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, search);
    await humanType(s.page, RECIPIENT);
    const row = s.page
      .locator('div[role="dialog"] [role="button"]')
      .filter({ hasText: RECIPIENT })
      .filter({ visible: true })
      .first();
    await row.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, row);
    await clickDescribed(s.page, 'the button in the dialog that opens the chat with the chosen person');
    // The composer is focused by a click before it is typed into; it sends on Enter.
    const composer = s.page
      .locator('div[contenteditable="true"][aria-label*="Message" i], div[role="textbox"][contenteditable="true"]')
      .filter({ visible: true })
      .first();
    await composer.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, composer);
    await humanType(s.page, MESSAGE);
    await s.page.keyboard.press('Enter');
    await pageSettled(s.page);
    if (!(await textShownOutsideEditors(s.page, MESSAGE)))
      throw new Error(`INSTAGRAM_DM_NOT_SHOWN: the message to @${RECIPIENT} was typed but the conversation does not show it`);
    return `DM sent to @${RECIPIENT}`;
  },
});
