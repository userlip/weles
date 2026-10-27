// Send a LinkedIn direct message from the recipient's public profile, through
// the shared action runner: the account's fresh jar, the signed-in gate, the
// inline relogin, the verdict and its record are the runner's. The profile's
// message control is the one deterministic DM path: the /messaging/ typeahead
// matches the wrong people on small accounts.
//
// Env: RECIPIENT_HANDLE (required): a vanity name or /in/ URL;
// DM_MESSAGE (required): the text, from a real account to a real person.
//
// A profile without a message control is one the account cannot message
// (not connected, no InMail): refused by name. The message counts once the
// conversation shows it outside the composer.
import { humanType } from '../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { detectLinkedInBanSignals } from '../../../../../dist/platforms/linkedin/ban_signals.js';
import { runAction } from '../../../_shared/action-runner.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { reloginLinkedinInline } from '../../../_shared/linkedin/relogin.mjs';
import { clickOffered } from '../../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { textShownOutsideEditors } from '../../../_shared/page/shows.mjs';

const RECIPIENT = statedText(
  ['RECIPIENT_HANDLE'],
  'the LinkedIn vanity or /in/ URL the DM goes to',
)
  .replace(/^@/, '')
  .replace(/\/$/, '');
const MESSAGE = statedText(
  ['DM_MESSAGE'],
  'the text sent from a real account to a real person',
);

await runAction({
  platform: 'linkedin',
  action: 'dm',
  // The recipient's profile carries LinkedIn's global nav, so the signed-in gate reads it there.
  feedUrl: /^https:\/\//.test(RECIPIENT)
    ? RECIPIENT
    : `https://www.linkedin.com/in/${encodeURIComponent(RECIPIENT)}/`,
  inlineRelogin: reloginLinkedinInline,
  banDetector: detectLinkedInBanSignals,
  act: async (s) => {
    if (
      !(await clickOffered(
        s.page,
        'the button on the profile that messages this person',
      ))
    )
      throw new Error(
        `LINKEDIN_DM_UNAVAILABLE: ${RECIPIENT}'s profile offers no message control (not connected; InMail required)`,
      );
    const composer = s.page
      .locator('div[role="textbox"][contenteditable="true"]')
      .filter({ visible: true })
      .first();
    await composer.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, composer);
    await humanType(s.page, MESSAGE);
    const send = s.page
      .locator('button[type="submit"]:enabled:not([aria-disabled="true"])')
      .filter({ visible: true })
      .first();
    await send.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, send);
    await pageSettled(s.page);
    if (!(await textShownOutsideEditors(s.page, MESSAGE)))
      throw new Error(
        'LINKEDIN_DM_UNCONFIRMED: the conversation does not show the message after sending',
      );
    return `sent a message to ${RECIPIENT}`;
  },
});
