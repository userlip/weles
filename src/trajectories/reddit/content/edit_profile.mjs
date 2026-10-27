// Write the linked character's display name, about text and avatar onto the
// Reddit profile (/settings/profile, modern shreddit), through the shared
// action runner and the shared profile editor (../../_shared/profile/edit.mjs).
//
// The text is saved and read back from a reloaded settings page before the
// avatar step leaves it. The avatar is set on the user page: its edit control
// opens a dialog whose image chooser takes the file; a brand-new account
// without its u_<name> profile subreddit cannot take one ("Unable to resolve
// profile") until it has posted.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectRedditBanSignals } from '../../../../dist/platforms/reddit/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { editProfileToCharacter } from '../../_shared/profile/edit.mjs';

const fields = (page) => ({
  name: page
    .locator('input[name*="display" i], input[id*="displayName" i]')
    .filter({ visible: true })
    .first(),
  bio: page
    .locator('textarea[name*="about" i], textarea[id*="about" i]')
    .filter({ visible: true })
    .first(),
});

await runAction({
  platform: 'reddit',
  action: 'edit_profile',
  feedUrl: 'https://www.reddit.com/settings/profile',
  banDetector: detectRedditBanSignals,
  act: (s, { acct }) =>
    editProfileToCharacter(s, acct, 'reddit', {
      fields,
      save: async (page) => {
        await clickDescribed(
          page,
          'the button that saves the profile settings',
        );
        await pageSettled(page);
      },
      kept: async (page) => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        const { name, bio } = fields(page);
        return { name: await name.inputValue(), bio: await bio.inputValue() };
      },
      uploadAvatar: async (page, file) => {
        await page.goto(`https://www.reddit.com/user/${acct.username}/`, {
          waitUntil: 'domcontentloaded',
        });
        await pageSettled(page);
        const avatar = page.locator('img[alt*="avatar" i]').first();
        const before = (await avatar.count())
          ? await avatar.getAttribute('src')
          : null;
        const edit = page.locator('[aria-label="Edit profile avatar"]').first();
        if (!(await edit.count()))
          throw new Error(
            'REDDIT_AVATAR_CONTROL_MISSING: the profile page shows no avatar edit control',
          );
        await humanClickLocator(page, edit);
        await pageSettled(page);
        const chooser = page.waitForEvent('filechooser');
        await clickDescribed(
          page,
          'the button that selects a new image for the avatar',
        );
        await (await chooser).setFiles(file);
        await pageSettled(page);
        await clickDescribed(
          page,
          'the enabled button that saves the new avatar',
        );
        await pageSettled(page);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        const after = (await avatar.count())
          ? await avatar.getAttribute('src')
          : null;
        if (!after || after === before)
          throw new Error(
            'REDDIT_AVATAR_UNCHANGED: the profile shows the same avatar after saving the new one',
          );
      },
      profileUrl: (username) => `https://www.reddit.com/user/${username}/`,
    }),
});
