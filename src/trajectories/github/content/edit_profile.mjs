// Write the linked character's persona (name, bio, location, avatar) onto the
// GitHub profile at /settings/profile, through the shared action runner: the
// account's fresh jar, the signed-in gate, the verdict and its record are the
// runner's. Every write must be acknowledged by GitHub's own response, and the
// profile is read back from a fresh page before Skarbiec is updated.
//
// Lives under github/content/ because github/actions/ is at the 5-file cap.
import { detectGitHubBanSignals } from '../../../../dist/platforms/github/ban_signals.js';
import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { runAction } from '../../_shared/action-runner.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { fitsField } from '../../_shared/page/fits.mjs';
import { pageSettled, responseAfterAction } from '../../_shared/page/settled.mjs';
import { loadAvatarFile } from '../../_shared/runner/avatar-loader.mjs';
import { accountCharacter, findAccount, updateAccountMetadata } from '../../_shared/skarbiec/accounts.mjs';

const PROFILE_URL = 'https://github.com/settings/profile';
const GITHUB = 'https://github.com';

const coded = (code, message, details) => Object.assign(new Error(`${code}: ${message}`), { code, ...details });

function postAt(request, origin, pathname) {
  if (request.method() !== 'POST') return false;
  const url = new URL(request.url());
  return url.origin === origin && pathname.test(url.pathname);
}

/** GitHub answered the write: a success, or the redirect a form post answers with, and the body arrived. */
async function acknowledged(response, operation) {
  const details = { operation, requestUrl: response.url(), status: response.status() };
  if (!response.ok() && !response.request().redirectedTo())
    throw coded('GH_PROFILE_HTTP_ERROR', `GitHub ${operation} returned HTTP ${details.status}`, details);
  const failed = await response.finished();
  if (failed) throw coded('GH_PROFILE_RESPONSE_FAILED', `GitHub ${operation} response did not complete: ${failed.message}`, details);
  console.log(`[gh-profile] ${operation} acknowledged: HTTP ${details.status}`);
}

/** A fresh read of the profile page, refused when GitHub does not serve it. */
async function openProfile(page) {
  const response = await page.goto(PROFILE_URL, { waitUntil: 'load' });
  if (!response.ok())
    throw coded('GH_PROFILE_READ_HTTP_ERROR', `GitHub served ${PROFILE_URL} with HTTP ${response.status()}`, { pageUrl: page.url() });
  await pageSettled(page);
}

function profileFields(page) {
  const visible = (selector) => page.locator(selector).filter({ visible: true }).first();
  return {
    name: visible('input#user_display_name, input[name="user\\[display_name\\]"]'),
    bio: visible('textarea#user_profile_bio, textarea[name="user[profile_bio]"]'),
    location: visible('input#user_profile_location, input[name="user[profile_location]"]'),
  };
}

/** The avatar uploaded through GitHub's policy, upload and commit, each acknowledged. */
async function setAvatar(page, avatarUrl) {
  const avatarFile = await loadAvatarFile(avatarUrl);
  const editor = page.locator('form[aria-label="Profile picture"] summary').filter({ visible: true }).first();
  if (await editor.isVisible()) await humanClickLocator(page, editor);
  const fileIn = page.locator('input#avatar_upload').first();
  await fileIn.waitFor({ state: 'attached' });
  const uploaded = await responseAfterAction(
    page,
    (request) => postAt(request, 'https://uploads.github.com', /^\/avatars\/?$/),
    async () => {
      const policy = await responseAfterAction(
        page,
        (request) => postAt(request, GITHUB, /^\/upload\/policies\/avatars\/?$/),
        () => fileIn.setInputFiles(avatarFile),
      );
      await acknowledged(policy, 'avatar upload policy');
    },
  );
  await acknowledged(uploaded, 'avatar upload');
  const committed = await responseAfterAction(
    page,
    (request) => postAt(request, GITHUB, /^\/settings\/avatars\/\d+\/?$/),
    () => clickDescribed(page, 'the button that sets the cropped image as the new profile picture'),
  );
  await acknowledged(committed, 'avatar commit');
}

/** Types each changed field and saves the form; the fields that changed. */
async function writeFields(page, targets) {
  const fields = profileFields(page);
  const changed = [];
  for (const [label, target] of Object.entries(targets)) {
    if (!target) continue;
    const field = fields[label];
    if (!(await field.isVisible())) throw coded('GH_PROFILE_FIELD_UNAVAILABLE', `the profile ${label} field is not visible`, { field: label });
    if ((await field.inputValue()).trim() === target.trim()) continue;
    if (!(await field.isEditable())) throw coded('GH_PROFILE_FIELD_LOCKED', `the profile ${label} field is not editable`, { field: label });
    await fitsField(field, target, `the GitHub profile ${label}`);
    await humanFill(page, field, target);
    await page.keyboard.press('Tab');
    const entered = await field.inputValue();
    if (entered.trim() !== target.trim())
      throw coded('GH_PROFILE_INPUT_MISMATCH', `the profile ${label} field holds ${entered.length} characters, not the ${target.length} typed`, {
        field: label,
      });
    changed.push(label);
  }
  if (!changed.length) return changed;
  const save = fields.bio.locator('xpath=ancestor::form[1]').locator('button[type="submit"], input[type="submit"]').first();
  if (!(await save.isVisible()) || !(await save.isEnabled()))
    throw coded('GH_PROFILE_SAVE_NOT_ENABLED', 'the profile form shows no enabled submit control');
  const target = await save.evaluate((button) => (button.hasAttribute('formaction') ? button.formAction : button.form.action));
  const destination = new URL(target);
  destination.hash = '';
  if (destination.origin !== GITHUB) throw coded('GH_PROFILE_FORM_UNSUPPORTED', `the profile form posts to ${destination.href}`);
  const saved = await responseAfterAction(
    page,
    (request) => request.method() === 'POST' && request.url() === destination.href,
    () => humanClickLocator(page, save),
  );
  await acknowledged(saved, 'profile save');
  return changed;
}

/** The fresh profile page holds every target, refused field by field when it does not. */
async function readBack(page, targets) {
  await openProfile(page);
  const fields = profileFields(page);
  for (const [label, target] of Object.entries(targets)) {
    if (!target) continue;
    if (!(await fields[label].isVisible()))
      throw coded('GH_PROFILE_FIELD_UNAVAILABLE', `the profile ${label} field is not visible on the fresh page`, { field: label });
    const observed = await fields[label].inputValue();
    if (observed.trim() !== target.trim())
      throw coded('GH_PROFILE_READBACK_MISMATCH', `the saved profile ${label} differs from the character's`, {
        field: label,
        expectedLength: target.length,
        observedLength: observed.length,
      });
  }
  return fields.name.inputValue();
}

await runAction({
  platform: 'github',
  action: 'edit_profile',
  feedUrl: PROFILE_URL,
  banDetector: detectGitHubBanSignals,
  act: async (s, { acct }) => {
    const character = accountCharacter(findAccount('github', acct.username));
    if (!character) throw coded('GH_PROFILE_CHARACTER_MISSING', `github/${acct.username} has no linked character`);
    console.log(`[gh-profile] character: ${character.name} (niche=${character.niche})`);
    const targets = {
      name: character.name,
      bio: character.bio,
      location: [character.home_city, character.home_country].filter(Boolean).join(', '),
    };
    const [firstImage] = Array.isArray(character.training_images) ? character.training_images : [];
    const avatarUrl = character.avatar_url ? character.avatar_url : firstImage;
    const writes = [];
    // An avatar commit can replace the document, so it goes before the text.
    if (avatarUrl) {
      await setAvatar(s.page, avatarUrl);
      writes.push('avatar');
      await openProfile(s.page);
    }
    writes.push(...(await writeFields(s.page, targets)));
    const observedName = await readBack(s.page, targets);
    updateAccountMetadata(acct.id, {
      display_name: observedName ? observedName : null,
      profile_url: `https://github.com/${acct.username}`,
      updated_at: new Date().toISOString(),
    });
    return writes.length
      ? `${acct.username} profile verified; changed ${writes.join(', ')}`
      : `${acct.username} profile already matches the character; Skarbiec synced`;
  },
});
