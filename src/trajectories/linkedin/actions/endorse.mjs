// Endorse a skill on a LinkedIn profile through the shared action runner:
// the account's fresh jar, the inline sign-in again when it is stale, the
// signed-in gate, the verdict and its record are the runner's.
//
// Env (both required):
//   TARGET_URL                the profile
//   ENDORSE_SKILL (or SVC_TEXT) the skill, as the profile lists it
//
// Each listed skill carries a button labelled "Endorse <skill>", which
// reads "Endorsed <skill>" or is pressed once endorsed. A skill the profile
// does not list, or has already endorsed, is refused.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectLinkedInBanSignals } from '../../../../dist/platforms/linkedin/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { reloginLinkedinInline } from '../../_shared/linkedin/relogin.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';

statedText(
  ['TARGET_URL'],
  'the LinkedIn profile to endorse',
  'LINKEDIN_ENDORSE_TARGET_REQUIRED',
);
const SKILL = statedText(
  ['ENDORSE_SKILL', 'SVC_TEXT'],
  'the skill on that profile to endorse, as the profile lists it',
  'LINKEDIN_ENDORSE_SKILL_REQUIRED',
);

await runAction({
  platform: 'linkedin',
  action: 'endorse',
  inlineRelogin: reloginLinkedinInline,
  banDetector: detectLinkedInBanSignals,
  act: async (s) => {
    await pageSettled(s.page);
    const endorse = s.page.getByRole('button', {
      name: `Endorse ${SKILL}`,
      exact: true,
      pressed: false,
    });
    if (!(await endorse.count()))
      throw new Error(
        `LINKEDIN_SKILL_NOT_OFFERED: the profile shows no "Endorse ${SKILL}" button: the skill is not listed there or is already endorsed`,
      );
    await humanClickLocator(s.page, endorse);
    await pageSettled(s.page);
    // A modal may ask for proficiency; its Endorse button completes it.
    const confirm = s.page
      .locator('div.artdeco-modal button:has-text("Endorse")')
      .first();
    if (await confirm.isVisible()) {
      await humanClickLocator(s.page, confirm);
      await pageSettled(s.page);
    }
    const endorsed = s.page
      .getByRole('button', { name: `Endorsed ${SKILL}`, exact: true })
      .or(
        s.page.getByRole('button', {
          name: `Endorse ${SKILL}`,
          exact: true,
          pressed: true,
        }),
      );
    if (!(await endorsed.count()))
      throw new Error(
        `LINKEDIN_ENDORSE_UNCONFIRMED: "${SKILL}" does not read as endorsed after the endorse click`,
      );
    return `endorsed ${SKILL}`;
  },
});
