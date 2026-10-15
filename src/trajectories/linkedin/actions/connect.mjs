// Invite a LinkedIn member to connect through the shared action runner:
// the account's fresh jar, the inline sign-in again when it is stale, the
// signed-in gate, the verdict and its record are the runner's.
//
// Env: TARGET_URL (required): the member's profile.
//
// The profile's own invite control sits in the page's main column; the
// suggestions of other people beside it are never touched. A profile already
// invited, or invited by this run, shows its Pending control.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectLinkedInBanSignals } from '../../../../dist/platforms/linkedin/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { reloginLinkedinInline } from '../../_shared/linkedin/relogin.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

const TARGET_URL = statedText(
  ['TARGET_URL'],
  'the LinkedIn profile to invite to connect',
  'LINKEDIN_CONNECT_TARGET_REQUIRED',
);

await runAction({
  platform: 'linkedin',
  action: 'connect',
  inlineRelogin: reloginLinkedinInline,
  banDetector: detectLinkedInBanSignals,
  act: async (s) => {
    await pageSettled(s.page);
    const profile = s.page.locator('main').first();
    const pending = profile.locator('button[aria-label*="Pending" i]').first();
    if (await pending.isVisible()) return `${TARGET_URL} is already invited`;
    const invite = profile
      .locator('button[aria-label^="Invite "][aria-label$="to connect"]')
      .filter({ visible: true })
      .first();
    if (!(await invite.count()))
      throw new Error(
        `LINKEDIN_NO_INVITE: ${TARGET_URL} offers no invite to connect on the profile itself`,
      );
    await humanClickLocator(s.page, invite);
    await pageSettled(s.page);
    // LinkedIn may confirm the invite in a modal before sending it.
    const send = s.page
      .locator(
        'div.artdeco-modal button[aria-label="Send now"], div.artdeco-modal button:has-text("Send")',
      )
      .first();
    if (await send.isVisible()) {
      await humanClickLocator(s.page, send);
      await pageSettled(s.page);
    }
    if (!(await pending.count()))
      throw new Error(
        `LINKEDIN_INVITE_UNCONFIRMED: ${TARGET_URL} shows no Pending invite after the invite click`,
      );
    return `invited ${TARGET_URL} to connect`;
  },
});
