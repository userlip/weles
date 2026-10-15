// Apply the linked character's name, headline, About and avatar to the
// LinkedIn profile, through the shared action runner: the account's fresh
// jar, the signed-in gate (on the feed, which carries the global nav the
// edit pages lack), the inline relogin, the verdict and its record are the
// runner's.
//
// The intro is edited by ./profile/intro.mjs; the About is saved and read
// back from a reloaded editor; the avatar counts once the profile shows a
// different photo. A requested change that does not take fails the run.
import { detectLinkedInBanSignals } from '../../../../dist/platforms/linkedin/ban_signals.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { reloginLinkedinInline } from '../../_shared/linkedin/relogin.mjs';
import { confirmedFill } from '../../_shared/page/confirmed-fill.mjs';
import { fitsField } from '../../_shared/page/fits.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { loadAvatarFile } from '../../_shared/runner/avatar-loader.mjs';
import { accountCharacter, findAccount, updateAccountMetadata } from '../../_shared/skarbiec/accounts.mjs';
import { editIntro } from './profile/intro.mjs';

/** The profile's own vanity name, from the address LinkedIn left the page on. */
function vanityOf(page, what) {
  const vanity = new URL(page.url()).pathname.match(/^\/in\/(?<name>[^/]+)/)?.groups.name;
  if (!vanity) throw new Error(`LINKEDIN_PROFILE_UNNAMED: ${page.url()} names no /in/<vanity> profile for the ${what}`);
  return vanity;
}

async function writeAbout(page, about) {
  await page.goto(`https://www.linkedin.com/in/${vanityOf(page, 'About')}/edit/about/`, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const field = page.locator('textarea').filter({ visible: true }).first();
  if (!(await field.count())) throw new Error(`LINKEDIN_ABOUT_FIELD_MISSING: the About editor shows no text field at ${page.url()}`);
  if ((await field.inputValue()) === about) return false;
  await fitsField(field, about, 'the LinkedIn about text');
  await confirmedFill(page, field, about, 'the LinkedIn about field');
  await clickDescribed(page, 'the button that saves the About section');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const kept = await field.inputValue();
  if (kept !== about) throw new Error(`LINKEDIN_ABOUT_NOT_SAVED: LinkedIn kept an About of ${kept.length} characters, not the ${about.length} requested`);
  return true;
}

async function writeAvatar(page, avatarUrl) {
  const avatar = await loadAvatarFile(avatarUrl);
  const profile = `https://www.linkedin.com/in/${vanityOf(page, 'avatar')}/`;
  await page.goto(profile, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const photo = page.locator('img[alt*="photo" i]').filter({ visible: true }).first();
  const before = (await photo.count()) ? await photo.getAttribute('src') : null;
  const edit = page.locator('a[aria-label*="photo" i], button[aria-label*="photo" i]').filter({ visible: true }).first();
  if (!(await edit.count())) throw new Error(`LINKEDIN_PHOTO_CONTROL_MISSING: the profile at ${page.url()} shows no photo-edit control`);
  await humanClickLocator(page, edit);
  await pageSettled(page);
  // The photo dialog carries a file input whatever its upload button says.
  const file = page.locator('input[type="file"]').first();
  if (!(await file.count())) throw new Error('LINKEDIN_PHOTO_INPUT_MISSING: the photo dialog has no file input');
  await file.setInputFiles(avatar);
  await pageSettled(page);
  await clickDescribed(page, 'the button in the photo dialog that saves or applies the new profile photo');
  await page.goto(profile, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const after = await photo.getAttribute('src');
  if (!after || after === before) throw new Error(`LINKEDIN_PHOTO_UNCHANGED: the profile photo at ${page.url()} did not change after saving`);
}

await runAction({
  platform: 'linkedin',
  action: 'edit_profile',
  feedUrl: 'https://www.linkedin.com/feed/',
  inlineRelogin: reloginLinkedinInline,
  banDetector: detectLinkedInBanSignals,
  act: async (s, { acct }) => {
    const character = accountCharacter(findAccount('linkedin', acct.username));
    if (!character) throw new Error(`LINKEDIN_PROFILE_CHARACTER_MISSING: linkedin/${acct.username} has no linked character`);
    console.log(`[li-profile] character: ${character.name} (niche=${character.niche})`);
    // The headline is the occupation when the character has one, else its niche.
    const headline = character.occupation ? character.occupation : character.niche;
    const writes = await editIntro(s, character, character.name ? character.name : '', headline);
    if (character.bio && (await writeAbout(s.page, character.bio))) writes.push('about');
    const [firstImage] = Array.isArray(character.training_images) ? character.training_images : [];
    const avatarUrl = character.avatar_url ? character.avatar_url : firstImage;
    if (avatarUrl) {
      await writeAvatar(s.page, avatarUrl);
      writes.push('avatar');
    }
    updateAccountMetadata(acct.id, {
      ...(character.name ? { display_name: character.name } : {}),
      profile_url: `https://www.linkedin.com/in/${acct.username}/`,
      updated_at: new Date().toISOString(),
    });
    return writes.length
      ? `${acct.username} profile changed: ${writes.join(', ')}`
      : `${acct.username} profile already matches the character; Skarbiec synced`;
  },
});
