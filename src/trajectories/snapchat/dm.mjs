// Send a Snapchat direct message through the shared action runner: the
// account's session and proxy, the signed-in gate (signing in again through
// ./sign_in.mjs when the kept session is gone), the ban signal and the kept
// verdict are runAction's. The recipient and the text are the caller's
// (RECIPIENT_HANDLE, DM_MESSAGE). The web app's controls are found by the
// vision model; the message counts once the chat thread shows it outside the
// composer.
import { humanType } from '../../../dist/human/keyboard.js';
import { detectSnapchatBanSignals } from '../../../dist/platforms/snapchat/ban_signals.js';
import { runAction } from '../_shared/action-runner.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { clickDescribed, clickOffered } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { textShownOutsideEditors } from '../_shared/page/shows.mjs';
import { WEB_APP, reloginSnapchat } from './sign_in.mjs';

const RECIPIENT = statedText(
  ['RECIPIENT_HANDLE'],
  'the Snapchat username the DM goes to',
).replace(/^@/, '');
const MESSAGE = statedText(
  ['DM_MESSAGE'],
  'the text sent from a real account to a real person',
);

await runAction({
  platform: 'snapchat',
  action: 'dm',
  feedUrl: WEB_APP.href,
  banDetector: detectSnapchatBanSignals,
  inlineRelogin: reloginSnapchat,
  act: async (s) => {
    await clickDescribed(s.page, 'the button that starts a new chat');
    await clickDescribed(s.page, 'the search field of the new chat');
    await humanType(s.page, RECIPIENT);
    await clickDescribed(
      s.page,
      `the search result for the Snapchat user ${RECIPIENT}`,
    );
    if (
      await clickOffered(
        s.page,
        'the button that opens the chat with the selected user',
      )
    )
      await pageSettled(s.page);
    await clickDescribed(s.page, 'the message field of the open chat');
    await humanType(s.page, MESSAGE);
    await s.page.keyboard.press('Enter');
    await pageSettled(s.page);
    if (!(await textShownOutsideEditors(s.page, MESSAGE)))
      throw new Error(
        `SNAPCHAT_DM_NOT_SHOWN: the chat with ${RECIPIENT} does not show the sent message`,
      );
    return `DM sent to @${RECIPIENT}`;
  },
});
