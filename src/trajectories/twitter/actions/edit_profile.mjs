// Write the linked character's name, bio and avatar onto the X profile,
// through the shared action runner and the shared profile editor
// (../../_shared/profile/edit.mjs).
//
// The profile's own edit control (an existing profile's edit modal, or a new
// account's set-up flow) is opened by its test id; both carry the name and bio
// fields and the avatar input. What X kept is read from the public profile.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { detectTwitterBanSignals } from '../../../../dist/platforms/twitter/ban_signals.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { editProfileToCharacter } from '../../_shared/profile/edit.mjs';

async function openEditor(page) {
  const edit = page
    .locator(
      'a[data-testid="editProfileButton"], button[data-testid="editProfileButton"], a[href="/settings/profile"]',
    )
    .filter({ visible: true })
    .first();
  await edit.waitFor({ state: 'visible' });
  await humanClickLocator(page, edit);
  await pageSettled(page);
}

async function save(page) {
  await clickDescribed(
    page,
    'the button that saves the profile (or completes its set-up)',
  );
  await pageSettled(page);
}

await runAction({
  platform: 'twitter',
  action: 'edit_profile',
  feedUrl: (username) => `https://x.com/${encodeURIComponent(username)}`,
  banDetector: detectTwitterBanSignals,
  act: async (s, { acct }) => {
    const profile = `https://x.com/${encodeURIComponent(acct.username)}`;
    await openEditor(s.page);
    return editProfileToCharacter(s, acct, 'twitter', {
      fields: (page) => ({
        name: page
          .locator('input[name="displayName"]')
          .filter({ visible: true })
          .first(),
        bio: page
          .locator('textarea[name="description"]')
          .filter({ visible: true })
          .first(),
      }),
      save,
      kept: async (page) => {
        await page.goto(profile, { waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        // The name block also shows the handle on its own line.
        const [name] = (
          await page.locator('[data-testid="UserName"]').first().innerText()
        ).split('\n');
        return {
          name,
          bio: await page
            .locator('[data-testid="UserDescription"]')
            .first()
            .innerText(),
        };
      },
      uploadAvatar: async (page, file) => {
        await page.goto(profile, { waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        const avatar = page
          .locator(`a[href="/${acct.username}/photo"] img`)
          .first();
        const before = (await avatar.count())
          ? await avatar.getAttribute('src')
          : null;
        await openEditor(page);
        const input = page.locator('input[data-testid="fileInput"]').first();
        if (!(await input.count()))
          throw new Error(
            'TWITTER_AVATAR_INPUT_MISSING: the profile editor has no avatar file input',
          );
        await input.setInputFiles(file);
        const apply = page
          .locator('button[data-testid="applyButton"]')
          .filter({ visible: true })
          .first();
        await apply.waitFor({ state: 'visible' });
        await humanClickLocator(page, apply);
        await save(page);
        await page.goto(profile, { waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        const after = (await avatar.count())
          ? await avatar.getAttribute('src')
          : null;
        if (!after || after === before)
          throw new Error(
            'TWITTER_AVATAR_UNCHANGED: the profile shows the same photo after saving the new one',
          );
      },
      profileUrl: (username) => `https://x.com/${username}`,
    });
  },
});
