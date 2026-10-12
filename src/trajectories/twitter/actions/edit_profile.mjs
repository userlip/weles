// Write the linked character's persona content (name + bio) onto the
// X/Twitter profile via the profile-edit modal.
//
// Companion to instagram/tiktok/linkedin edit_profile.

import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  confirmedFill,
  statedField,
} from '../../_shared/page/confirmed-fill.mjs';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import {
  assertAuthed,
  AuthProbeError,
} from '../../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../../_shared/auth/cookie-freshness.mjs';
import { loadAvatarFile } from '../../_shared/runner/avatar-loader.mjs';
import { updateAccountMetadata } from '../../_shared/skarbiec/accounts.mjs';
import { fitsField } from '../../_shared/page/fits.mjs';

const acct = await getSocialAccount('twitter');
if (!acct) {
  console.log('FAIL: no active twitter account in Skarbiec');
  process.exit(1);
}
console.log(`[tw-profile] using account: ${acct.username}`);
const character = acct.metadata?.character;
if (!character || typeof character !== 'object') {
  console.log(`FAIL: no character stored for twitter/${acct.username}`);
  process.exit(1);
}
console.log(
  `[tw-profile] character: ${character.name} (niche=${character.niche})`,
);
const avatarUrl =
  character.avatar_url ||
  (Array.isArray(character.training_images)
    ? character.training_images[0]
    : null);

// A character without a name leaves the profile's name as it is; an empty
// one typed in would erase it.
const targetName = character.name;
// The bio goes up whole; the field's own maxlength decides whether it fits.
const targetBio = character.bio;

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'twitter_edit_profile',
  proxy: proxyUrl,
  persona,
});

try {
  let stored;
  try {
    const all = loadFreshCookieJarOrFail(acct, {
      platform: 'twitter',
      label: 'twitter_edit_profile',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    stored = all.filter((c) =>
      /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(c.domain ?? ''),
    );
    if (!stored.length)
      throw new CookieJarStaleError(
        'cookie_jar_no_domain_match: jar fresh but no x.com/twitter.com cookies',
        { platform: 'twitter' },
      );
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx.addCookies(stored.map((c) => ({ ...c, path: c.path || '/' })));

  // Land on home first so assertAuthed has a known authed surface, then
  // navigate to the profile and click "Edit profile".
  await s.page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
  await humanIdlePause('deliberate');
  if (/\/(i\/flow\/login|login)/.test(s.page.url())) {
    await markCookiesStale(acct.id);
    throw new Error(`cookies stale, redirected to login (${s.page.url()})`);
  }
  try {
    await assertAuthed('twitter', s, { label: 'twitter_edit_profile' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }

  await s.page.goto(`https://x.com/${encodeURIComponent(acct.username)}`, {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('deliberate');

  // Twitter exposes one of two affordances on the user's own profile:
  //   * "Edit profile" → opens an inline modal (existing populated profile)
  //   * "Set up profile" / data-testid="editProfileButton" → routes to
  //     /i/flow/setup_profile (fresh account, never customized).
  // Both flows surface input[data-testid="fileInput"] for the avatar plus
  // text fields for name/bio.
  const editBtn = s.page
    .locator(
      'a[data-testid="edit_profile"], a[href="/settings/profile"], button[data-testid="editProfileButton"], a[data-testid="editProfileButton"], [data-testid="editProfileButton"], div[role="button"]:has-text("Edit profile")',
    )
    .filter({ visible: true })
    .first();
  await editBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, editBtn);
  await humanIdlePause('deliberate');

  // The Edit-profile modal exposes:
  //   Name → input[name="displayName"]
  //   Bio  → textarea[name="description"]
  const nameIn = s.page
    .locator('input[name="displayName"], input[aria-label="Name"]')
    .filter({ visible: true })
    .first();
  const bioIn = s.page
    .locator('textarea[name="description"], textarea[aria-label*="Bio" i]')
    .filter({ visible: true })
    .first();

  const writes = [];
  if (await statedField(nameIn, targetName, 'the X name field')) {
    const cur = await nameIn.inputValue();
    if (cur.trim() !== targetName.trim()) {
      await confirmedFill(s.page, nameIn, targetName, 'the X name field');
      writes.push(`name "${cur}" -> "${targetName}"`);
    }
  }
  if (await statedField(bioIn, targetBio, 'the X bio field')) {
    const cur = await bioIn.inputValue();
    if (cur.trim() !== targetBio.trim()) {
      await fitsField(bioIn, targetBio, 'the X bio');
      await confirmedFill(s.page, bioIn, targetBio, 'the X bio field');
      writes.push(`bio (${cur.length} -> ${targetBio.length} chars)`);
    }
  }

  // The account record says the profile carries the character's name; it is
  // written once the form already matches or the save went through, never
  // before: a save that failed left the record naming a profile X never had.
  const recordProfile = () =>
    updateAccountMetadata(acct.id, {
      display_name: targetName || null,
      profile_url: `https://x.com/${acct.username}`,
      updated_at: new Date().toISOString(),
    });

  // Avatar upload — both Edit and Set-up flows expose
  // input[data-testid="fileInput"]. Twitter's crop modal shows "Apply" once
  // the file is loaded. A requested avatar that could not be read, placed or
  // applied fails the run: a PASS would claim a picture the profile lacks.
  if (avatarUrl) {
    const tmpAvatar = await loadAvatarFile(avatarUrl);
    const fileIn = s.page.locator('input[data-testid="fileInput"]').first();
    if (!(await fileIn.count()))
      throw new Error(
        'the X profile editor has no avatar file input; the requested avatar was not uploaded',
      );
    await fileIn.setInputFiles(tmpAvatar);
    const applyBtn = s.page
      .locator(
        'button[data-testid="applyButton"], div[role="button"]:has-text("Apply"), button:has-text("Apply")',
      )
      .filter({ visible: true })
      .first();
    await applyBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, applyBtn);
    writes.push('avatar uploaded');
    await humanIdlePause('deliberate');
  }

  if (!writes.length) {
    recordProfile();
    console.log(
      'PASS: no-op (form values already match character; Skarbiec synced)',
    );
  } else {
    console.log(`[tw-profile] writes: ${writes.join('; ')}`);

    // Save: Profile_Save_Button (Edit flow) or Next/Done (setup flow).
    const saveBtn = s.page
      .locator(
        'button[data-testid="Profile_Save_Button"], button[data-testid="ocfSelectAvatarNextButton"], button[data-testid="OCF_CallToAction_Button"], div[role="button"]:has-text("Save"), button:has-text("Save"), button:has-text("Done")',
      )
      .filter({ visible: true })
      .first();
    await saveBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, saveBtn);
    await humanIdlePause('long');
    recordProfile();
    console.log(`PASS: ${acct.username} profile updated to ${character.name}`);
  }
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
