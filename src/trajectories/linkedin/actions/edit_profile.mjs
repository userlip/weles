// Apply the linked character's stated name, headline, about and avatar to
// the authenticated LinkedIn profile.

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
import { pageSettled, reviewUntilClosed } from '../../_shared/page/settled.mjs';
import { fitsField } from '../../_shared/page/fits.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { editIntro } from './profile/intro.mjs';

const acct = await getSocialAccount('linkedin');
if (!acct) {
  console.log('FAIL: no active linkedin account in Skarbiec');
  process.exit(1);
}
console.log(`[li-profile] using account: ${acct.username}`);
const character = acct.metadata?.character;
if (!character || typeof character !== 'object') {
  console.log(`FAIL: no character stored for linkedin/${acct.username}`);
  process.exit(1);
}
console.log(
  `[li-profile] character: ${character.name} (niche=${character.niche})`,
);
const avatarUrl =
  character.avatar_url ||
  (Array.isArray(character.training_images)
    ? character.training_images[0]
    : null);

const targetName = character.name || '';
// Headline = occupation if present, else niche; about = the bio. Each goes up
// whole, and its field's own maxlength decides whether it fits.
const targetHeadline = character.occupation ?? character.niche;
const targetAbout = character.bio;

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'linkedin_edit_profile',
  proxy: proxyUrl,
  persona,
});

try {
  let stored;
  try {
    const all = loadFreshCookieJarOrFail(acct, {
      platform: 'linkedin',
      label: 'linkedin_edit_profile',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    stored = all.filter((c) => /linkedin\.com/.test(c.domain ?? ''));
    if (!stored.length)
      throw new CookieJarStaleError(
        'cookie_jar_no_domain_match: jar fresh but no linkedin.com cookies',
        { platform: 'linkedin' },
      );
  } catch (jarErr) {
    if (jarErr instanceof CookieJarStaleError) await markCookiesStale(acct.id);
    throw jarErr;
  }
  await s.ctx.addCookies(stored.map((c) => ({ ...c, path: c.path || '/' })));

  // Hit /feed/ first to confirm auth via primary-nav. The
  // /in/me/edit-form/intro/ page renders an edit-modal-only view that does
  // NOT expose the global nav, so assertAuthed false-fails there even on
  // valid sessions. After /feed/ confirms auth, navigate to the edit URL.
  await s.page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('deliberate');
  if (
    ['/login', '/checkpoint', '/uas'].some((wall) =>
      new URL(s.page.url()).pathname.startsWith(wall),
    )
  ) {
    const error = new Error(`cookies stale, redirected to ${s.page.url()}`);
    await markCookiesStale(acct.id);
    throw error;
  }
  try {
    await assertAuthed('linkedin', s, { label: 'linkedin_edit_profile' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }
  const writes = await editIntro(s, character, targetName, targetHeadline);

  // About is edited separately from the intro form and requires its own
  // persisted readback before any avatar work or metadata update.
  if (targetAbout) {
    const myVanity = s.page.url().match(/\/in\/([^/?]+)/)?.pop();
    if (!myVanity)
      throw new Error(
        `the LinkedIn profile URL ${s.page.url()} names no account for the requested About update`,
      );
    await s.page.goto(`https://www.linkedin.com/in/${myVanity}/edit/about/`, {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(s.page);
    const aboutIn = s.page
      .locator('textarea')
      .filter({ visible: true })
      .first();
    if (!(await aboutIn.count()))
      throw new Error(
        `the LinkedIn About editor has no visible text field at ${s.page.url()}; the requested About was not written`,
      );
    const current = await aboutIn.inputValue();
    if (current !== targetAbout) {
      await fitsField(aboutIn, targetAbout, 'the LinkedIn about text');
      await confirmedFill(s.page, aboutIn, targetAbout, 'the LinkedIn about field');
      await s.page.keyboard.press('Tab');
      const saveBtn = s.page
        .locator('button:has-text("Save")')
        .filter({ visible: true })
        .first();
      if (!(await saveBtn.isEnabled()))
        throw new Error('the LinkedIn About Save control is not enabled');
      await humanClickLocator(s.page, saveBtn);
      await s.page.reload({ waitUntil: 'domcontentloaded' });
      await pageSettled(s.page);
      const kept = await aboutIn.inputValue();
      if (kept !== targetAbout)
        throw new Error(
          `LinkedIn kept an About of ${kept.length} characters, not the ${targetAbout.length} requested; the profile is unconfirmed`,
        );
      writes.push(`about (${current.length} -> ${targetAbout.length} chars)`);
    }
  }

  // A requested avatar fails the run if its input or save control is absent.
  console.log(
    `[li-profile] entering avatar block (avatarUrl=${avatarUrl ? 'yes' : 'none'})`,
  );
  if (avatarUrl) {
    const tmpAvatar = await loadAvatarFile(avatarUrl);
    const myVanity = s.page.url().match(/\/in\/([^/?]+)/)?.[1];
    if (!myVanity)
      throw new Error(
        `the page ${s.page.url()} names no /in/<vanity> profile to open for the avatar; the requested avatar was not uploaded`,
      );
    await s.page.goto(`https://www.linkedin.com/in/${myVanity}/`, {
      waitUntil: 'domcontentloaded',
    });
    await humanIdlePause('deliberate');
    const photo = s.page
      .locator('img[alt*="photo" i]')
      .filter({ visible: true })
      .first();
    const beforePhoto = (await photo.count())
      ? await photo.getAttribute('src')
      : null;
    const addPhotoBtn = s.page
      .locator('a[aria-label*="photo" i], button[aria-label*="photo" i]')
      .filter({ visible: true })
      .first();
    if (!(await addPhotoBtn.count()))
      throw new Error(
        `the LinkedIn profile has no photo-edit control at ${s.page.url()}; the requested avatar was not uploaded`,
      );
    await humanClickLocator(s.page, addPhotoBtn);
    await pageSettled(s.page);
    // The photo dialog carries a file input whatever its upload button says.
    const fIn = s.page.locator('input[type="file"]').first();
    if (!(await fIn.count()))
      throw new Error(
        'the LinkedIn photo dialog has no file input; the requested avatar was not uploaded',
      );
    await fIn.setInputFiles(tmpAvatar);
    await humanIdlePause('deliberate');
    await clickDescribed(
      s.page,
      'the button in the photo dialog that saves or applies the new profile photo',
    );
    await s.page.goto(`https://www.linkedin.com/in/${myVanity}/`, {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(s.page);
    const afterPhoto = await photo.getAttribute('src');
    if (!afterPhoto || afterPhoto === beforePhoto)
      throw new Error(
        `the LinkedIn profile photo at ${s.page.url()} did not change after Save; the requested avatar is unconfirmed`,
      );
    writes.push('avatar uploaded and visible on profile');
  }

  updateAccountMetadata(acct.id, {
    ...(typeof targetName === 'string' && targetName.trim()
      ? { display_name: targetName }
      : {}),
    profile_url: `https://www.linkedin.com/in/${acct.username}/`,
    updated_at: new Date().toISOString(),
  });

  if (!writes.length)
    console.log(
      'PASS: no-op (form values already match character; Skarbiec synced)',
    );
  else
    console.log(`PASS: ${acct.username} profile updated to ${character.name}`);
} catch (e) {
  console.log('FAIL:', e);
  process.exitCode = 1;
} finally {
  try {
    // Explicit review holds only an existing page and releases every observer.
    if (process.env.WELES_KEEP_OPEN === '1' && !s.page.isClosed()) {
      console.log(
        '[li-profile] WELES_KEEP_OPEN=1 — browser left open. Close window or Ctrl+C to exit.',
      );
      await reviewUntilClosed(s);
    }
  } finally {
    await s.close();
  }
}
