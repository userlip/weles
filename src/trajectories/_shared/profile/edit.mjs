// Writing an account's linked character onto its platform profile, the one
// way every edit_profile does it: the character comes from the account's
// Skarbiec record; a name or bio already held is left alone, a different one
// is typed (checked against the field's own maxlength, and read back from the
// field); the platform's save runs only when something changed, and what the
// platform kept is read back and compared; the avatar, when the character has
// one, is uploaded through the platform's own control. The account record is
// updated last, so it never names a profile the platform does not show.
//
// A platform supplies its editor:
//   fields(page)          { name, bio }: the locators of its text fields
//   save(page)            saves the typed text
//   kept(page)            { name, bio }: what the platform shows after saving
//   uploadAvatar(page, f) uploads the image file f and proves it took
//   profileUrl(username)  the public profile address kept in the record
import { confirmedFill, statedField } from '../page/confirmed-fill.mjs';
import { fitsField } from '../page/fits.mjs';
import { shows } from '../page/shows.mjs';
import { loadAvatarFile } from '../runner/avatar-loader.mjs';
import {
  accountCharacter,
  findAccount,
  updateAccountMetadata,
} from '../skarbiec/accounts.mjs';

/** The account's linked character, refused when it has none. */
export function linkedCharacter(platform, acct) {
  const character = accountCharacter(findAccount(platform, acct.username));
  if (!character)
    throw new Error(
      `PROFILE_CHARACTER_MISSING: ${platform}/${acct.username} has no linked character`,
    );
  console.log(
    `[${platform}-profile] character: ${character.name} (niche=${character.niche})`,
  );
  return character;
}

/** Edits the profile on `s.page` to `acct`'s character through `editor`; answers what changed. */
export async function editProfileToCharacter(s, acct, platform, editor) {
  const character = linkedCharacter(platform, acct);
  const targets = { name: character.name, bio: character.bio };
  const fields = editor.fields(s.page);
  const changed = [];
  for (const [label, target] of Object.entries(targets)) {
    const field = fields[label];
    if (!(await statedField(field, target, `the ${platform} ${label} field`)))
      continue;
    if ((await field.inputValue()) === target) continue;
    await fitsField(field, target, `the ${platform} ${label}`);
    await confirmedFill(
      s.page,
      field,
      target,
      `the ${platform} ${label} field`,
    );
    changed.push(label);
  }
  if (changed.length) {
    await editor.save(s.page);
    const kept = await editor.kept(s.page);
    for (const label of changed)
      if (!shows(String(kept[label]), targets[label]))
        throw new Error(
          `PROFILE_NOT_SAVED: ${platform} shows a different ${label} after saving (${String(kept[label]).length} characters)`,
        );
  }
  const [firstImage] = Array.isArray(character.training_images)
    ? character.training_images
    : [];
  const avatarUrl = character.avatar_url ? character.avatar_url : firstImage;
  if (avatarUrl) {
    await editor.uploadAvatar(s.page, await loadAvatarFile(avatarUrl));
    changed.push('avatar');
  }
  updateAccountMetadata(acct.id, {
    ...(character.name ? { display_name: character.name } : {}),
    profile_url: editor.profileUrl(acct.username),
    updated_at: new Date().toISOString(),
  });
  return changed.length
    ? `${acct.username} profile changed: ${changed.join(', ')}`
    : `${acct.username} profile already matches the character`;
}
