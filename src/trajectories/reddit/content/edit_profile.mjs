// Write the linked character's display_name + bio onto the reddit profile
// via /settings/profile (modern shreddit). Companion to the per-platform
// edit_profile chain.

import {
  getSocialAccount,
  resolveAccountSession,
  markCookiesStale,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { confirmedFill } from '../../_shared/page/confirmed-fill.mjs';
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

const acct = await getSocialAccount('reddit');
if (!acct) {
  console.log('FAIL: no active reddit account in Skarbiec');
  process.exit(1);
}
console.log(`[rd-profile] using account: ${acct.username}`);
const character = acct.metadata?.character;
if (!character || typeof character !== 'object') {
  console.log(`FAIL: no character stored for reddit/${acct.username}`);
  process.exit(1);
}
console.log(
  `[rd-profile] character: ${character.name} (niche=${character.niche})`,
);
const avatarUrl =
  character.avatar_url ||
  (Array.isArray(character.training_images)
    ? character.training_images[0]
    : null);

// Name and bio go up whole; each field's own maxlength decides whether they fit.
const targetName = character.name;
const targetBio = character.bio;

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'reddit_edit_profile',
  proxy: proxyUrl,
  persona,
});

try {
  let stored;
  try {
    const all = loadFreshCookieJarOrFail(acct, {
      platform: 'reddit',
      label: 'reddit_edit_profile',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    stored = all.filter((c) => /reddit\.com/.test(c.domain ?? ''));
    if (!stored.length)
      throw new CookieJarStaleError(
        'cookie_jar_no_domain_match: jar fresh but no reddit.com cookies',
        { platform: 'reddit' },
      );
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx.addCookies(stored.map((c) => ({ ...c, path: c.path || '/' })));

  await s.page.goto('https://www.reddit.com/settings/profile', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  if (/\/login/.test(s.page.url())) {
    await markCookiesStale(acct.id);
    throw new Error(`cookies stale, redirected to login (${s.page.url()})`);
  }
  try {
    await assertAuthed('reddit', s, { label: 'reddit_edit_profile' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }

  // shreddit /settings/profile fields. The exact selectors vary across
  // cohorts, so try a wide net.
  const nameIn = s.page
    .locator(
      'input[name*="display" i], input[id*="displayName" i], input[aria-label*="display name" i]',
    )
    .filter({ visible: true })
    .first();
  const bioIn = s.page
    .locator(
      'textarea[name*="about" i], textarea[id*="about" i], textarea[aria-label*="about" i], textarea[placeholder*="about" i]',
    )
    .filter({ visible: true })
    .first();

  const writes = [];
  if (targetName && (await nameIn.count())) {
    const cur = await nameIn.inputValue();
    if (cur.trim() !== targetName.trim()) {
      await fitsField(nameIn, targetName, 'the Reddit display name');
      await confirmedFill(
        s.page,
        nameIn,
        targetName,
        'the Reddit display name field',
      );
      writes.push(`name "${cur}" -> "${targetName}"`);
    }
  }
  if (targetBio && (await bioIn.count())) {
    const cur = await bioIn.inputValue();
    if (cur.trim() !== targetBio.trim()) {
      await fitsField(bioIn, targetBio, 'the Reddit about text');
      await confirmedFill(s.page, bioIn, targetBio, 'the Reddit about field');
      writes.push(`bio (${cur.length} -> ${targetBio.length} chars)`);
    }
  }

  // Avatar upload — reddit's avatar-edit affordance lives on the user
  // profile page:
  //   1. nav /user/<u>/
  //   2. click button[aria-label="Edit profile avatar"] → modal opens with
  //      "Select a new image" + Save button
  //   3. click "Select a new image" → fires filechooser
  //   4. setFiles → enables Save in the modal
  //   5. The Save button lives in shadow DOM; pierce + click via evaluate
  //
  // Backend caveat: shreddit's CreateProfileStructuredStylesUploadLease
  // mutation needs the u_<username> subreddit to exist. Brand-new accounts
  // that have never posted see "Unable to resolve profile" — make a
  // throwaway post first if your account is fresh.
  //
  // A requested avatar that could not be read, selected or saved fails the
  // run: a PASS would claim a picture the profile lacks.
  if (avatarUrl) {
    const tmpAvatar = await loadAvatarFile(avatarUrl);
    await s.page.goto(`https://www.reddit.com/user/${acct.username}/`, {
      waitUntil: 'domcontentloaded',
    });
    await humanIdlePause('long');
    const editAvatarBtn = s.page
      .locator(
        'button[aria-label="Edit profile avatar"], [aria-label="Edit profile avatar"]',
      )
      .first();
    if (!(await editAvatarBtn.count()))
      throw new Error(
        'the Reddit profile page shows no Edit profile avatar control; the requested avatar was not uploaded',
      );
    await humanClickLocator(s.page, editAvatarBtn);
    await humanIdlePause('deliberate');
    const selectBtn = s.page
      .locator('button:has-text("Select a new image")')
      .first();
    if (!(await selectBtn.count()))
      throw new Error(
        'the Reddit avatar dialog offers no Select a new image control; the requested avatar was not uploaded',
      );
    const fcPromise = s.page.waitForEvent('filechooser');
    await humanClickLocator(s.page, selectBtn);
    const fc = await fcPromise;
    await fc.setFiles(tmpAvatar);
    await humanIdlePause('long');
    // Save lives in shadow DOM; Playwright locators pierce open shadow roots.
    const saveCandidates = await s.page
      .getByRole('button', { name: 'Save', exact: true })
      .filter({ visible: true })
      .all();
    let saveBtn = null;
    for (const candidate of saveCandidates) {
      if (await candidate.isEnabled()) {
        saveBtn = candidate;
        break;
      }
    }
    if (!saveBtn)
      throw new Error(
        `the Reddit avatar dialog shows ${saveCandidates.length} Save button(s), none enabled after the image was chosen; the requested avatar was not saved`,
      );
    await humanClickLocator(s.page, saveBtn);
    await humanIdlePause('long');
    writes.push('avatar uploaded');
  }

  // The account record says the profile carries the character's name; it is
  // written once the form already matches or the save went through, never
  // before: a save that failed left the record naming a profile Reddit never had.
  const recordProfile = () =>
    updateAccountMetadata(acct.id, {
      display_name: targetName || null,
      profile_url: `https://www.reddit.com/user/${acct.username}/`,
      updated_at: new Date().toISOString(),
    });

  if (!writes.length) {
    recordProfile();
    console.log(
      'PASS: no-op (form values already match character; Skarbiec synced)',
    );
  } else {
    console.log(`[rd-profile] writes: ${writes.join('; ')}`);

    // shreddit's save uses a Save button at the bottom of the form section.
    const saveBtn = s.page
      .locator('button:has-text("Save"), button[type="submit"]')
      .filter({ visible: true })
      .first();
    await saveBtn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, saveBtn);
    await humanIdlePause('deliberate');
    recordProfile();
    console.log(`PASS: ${acct.username} profile updated to ${character.name}`);
  }
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
