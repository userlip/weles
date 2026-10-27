// Write the linked character's name, bio and avatar onto the TikTok profile
// at /setting, through the shared action runner and the shared profile editor
// (../../_shared/profile/edit.mjs).
//
// Some cohorts keep the fields behind an edit control. The edit, photo, apply
// and save controls are found by the vision model in whatever language TikTok
// renders; what TikTok kept is read from a reloaded settings page.
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import {
  clickDescribed,
  clickOffered,
} from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { editProfileToCharacter } from '../../_shared/profile/edit.mjs';

const fields = (page) => ({
  name: page
    .locator('input[data-e2e*="name" i]')
    .filter({ visible: true })
    .first(),
  bio: page
    .locator('textarea[data-e2e*="bio" i]')
    .filter({ visible: true })
    .first(),
});

await runAction({
  platform: 'tiktok',
  action: 'edit_profile',
  feedUrl: 'https://www.tiktok.com/setting',
  banDetector: detectTikTokBanSignals,
  act: async (s, { acct }) => {
    if (await clickOffered(s.page, 'the button that opens the profile editor'))
      await pageSettled(s.page);
    return editProfileToCharacter(s, acct, 'tiktok', {
      fields,
      save: async (page) => {
        await clickDescribed(page, 'the button that saves the profile');
        await pageSettled(page);
      },
      kept: async (page) => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        if (
          await clickOffered(page, 'the button that opens the profile editor')
        )
          await pageSettled(page);
        const { name, bio } = fields(page);
        return { name: await name.inputValue(), bio: await bio.inputValue() };
      },
      uploadAvatar: async (page, file) => {
        await clickDescribed(
          page,
          'the control that changes the profile photo',
        );
        const input = page
          .locator('input[type="file"][accept*="image"]')
          .first();
        if (!(await input.count()))
          throw new Error(
            'TIKTOK_AVATAR_INPUT_MISSING: the profile settings offer no image file input',
          );
        await input.setInputFiles(file);
        await clickDescribed(page, 'the button that applies the cropped photo');
        await clickDescribed(page, 'the button that saves the profile');
        await pageSettled(page);
      },
      profileUrl: (username) => `https://www.tiktok.com/@${username}`,
    });
  },
});
