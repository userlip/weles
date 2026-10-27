// Write the linked character's name, bio and avatar onto the Instagram
// profile at /accounts/edit/, through the shared action runner and the shared
// profile editor (../../_shared/profile/edit.mjs).
//
// The save and the photo upload each count once Instagram's own answer to
// them succeeds; what Instagram kept is read from a reloaded form.
import { detectInstagramBanSignals } from '../../../../dist/platforms/instagram/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import {
  pageSettled,
  responseAfterAction,
} from '../../_shared/page/settled.mjs';
import { editProfileToCharacter } from '../../_shared/profile/edit.mjs';

/** A POST to an Instagram path containing `fragment`, answered successfully, or refused naming `what`. */
async function acknowledged(page, fragment, what, action) {
  const answer = await responseAfterAction(
    page,
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname.includes(fragment),
    action,
  );
  if (!answer.ok())
    throw new Error(
      `INSTAGRAM_PROFILE_WRITE_REFUSED: the ${what} answered HTTP ${answer.status()}`,
    );
}

const fields = (page) => ({
  name: page
    .locator('input[name="full_name" i], input[aria-label*="Name" i]')
    .filter({ visible: true })
    .first(),
  bio: page
    .locator('textarea[name="biography" i], textarea[aria-label*="Bio" i]')
    .filter({ visible: true })
    .first(),
});

await runAction({
  platform: 'instagram',
  action: 'edit_profile',
  feedUrl: 'https://www.instagram.com/accounts/edit/',
  banDetector: detectInstagramBanSignals,
  act: (s, { acct }) =>
    editProfileToCharacter(s, acct, 'instagram', {
      fields,
      save: (page) =>
        acknowledged(page, '/accounts/edit', 'profile form submission', () =>
          clickDescribed(page, 'the button that submits the profile form'),
        ),
      kept: async (page) => {
        // The fields of a submitted page still hold what was typed.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        const { name, bio } = fields(page);
        return { name: await name.inputValue(), bio: await bio.inputValue() };
      },
      uploadAvatar: async (page, file) => {
        // The photo dialog binds a hidden image input whatever its buttons say.
        await clickDescribed(
          page,
          'the control that changes the profile photo',
        );
        const input = page
          .locator('input[type="file"][accept*="image"]')
          .first();
        if (!(await input.count()))
          throw new Error(
            'INSTAGRAM_AVATAR_INPUT_MISSING: the photo dialog has no image file input',
          );
        await acknowledged(
          page,
          'profile_picture',
          'profile photo upload',
          () => input.setInputFiles(file),
        );
      },
      profileUrl: (username) => `https://www.instagram.com/${username}/`,
    }),
});
