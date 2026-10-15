// Capture screenshot + video evidence of a shared Drive folder and the
// version-history panels of its editor files, from a real signed-in session.
//
// Reads the file inventory from a drive_preserve.py archive directory and
// visits every file's webViewLink. For Docs/Sheets/Slides it opens the native
// Version history panel through the File menu (found by the vision model, so
// the click sequence is itself in the recording) and scrolls it to the end.
// A scroll series ends when the area no longer moves or two consecutive
// frames are identical. Every shot is logged in a manifest with URL, UTC
// timestamp and sha256; the .webm session recording lands in
// recordings/<label>/ as continuous evidence. A file that fails is recorded in
// the manifest and makes the run's exit status a failure; a session signed
// out mid-run aborts it, because anonymous shots are not evidence.
//
// Run:
//   WELES_NO_INSTRUMENT=1 \
//   node weles/src/trajectories/google/drive/evidence/version_history.mjs \
//     --archive <drive_preserve output dir> --out <manifest.json path>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WSession } from '../../../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../../../dist/cli/usage.js';
import { googleSso } from '../../../_shared/services/google_sso.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { readScopedLogin } from '../../../../_shared/scoped-secrets.mjs';

const { values: ARGS } = parseArgs({ options: { archive: { type: 'string' }, out: { type: 'string' } } });
if (!ARGS.archive || !ARGS.out)
  throw new Error('DRIVE_EVIDENCE_ARGUMENTS_MISSING: --archive <drive_preserve output dir> and --out <manifest.json path> are required');
const ARCHIVE = ARGS.archive;
const OUT_PATH = ARGS.out;
const LABEL = 'drive_version_history';
const INDENT = '  ';
const GOOGLE_SIGN_IN_HOST = 'accounts.google.com';
const EDITOR_MIMES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

class SignedOutMidRun extends Error {}

const log = (...parts) => console.error(`[${LABEL}]`, ...parts);
const nowIso = () => new Date().toISOString();
const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const rootMeta = JSON.parse(readFileSync(join(ARCHIVE, 'folder_metadata.json'), 'utf8')).root;
const metas = readdirSync(join(ARCHIVE, 'files'))
  .map((id) => JSON.parse(readFileSync(join(ARCHIVE, 'files', id, 'metadata.json'), 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name));

const creds = readScopedLogin('googleDrive');
const s = await WSession.start({ label: LABEL, browser: 'chromium' });
const shots = [];
const errors = [];

async function shot(tag) {
  const path = await s.screenshot(tag);
  const entry = { tag, path, url: s.page.url(), captured_at: nowIso(), sha256: sha256File(path) };
  shots.push(entry);
  return entry;
}

/**
 * Scrolls, by one view, the largest area near `anchor` that still moves: the
 * anchor's ancestors are searched outward, and within each its overflowing
 * elements, largest first, are scrolled until one actually moves. False when
 * nothing near the anchor moves any further.
 */
function scrollNear(anchor) {
  return anchor.evaluate((start) => {
    for (let level = start; level; level = level.parentElement) {
      const overflowing = [level, ...level.querySelectorAll('*')]
        .filter((node) => node.scrollHeight > node.clientHeight)
        .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth);
      for (const area of overflowing) {
        const before = area.scrollTop;
        area.scrollBy({ top: area.clientHeight });
        if (area.scrollTop !== before) return true;
      }
    }
    return false;
  });
}

/** Shots of the area near `anchor`, view by view until it stops moving or two frames are identical; the frame count. */
async function scrollSeries(tag, anchor) {
  const frames = [];
  for (;;) {
    const frame = await shot(`${tag}_${frames.length}`);
    if (frames.includes(frame.sha256)) return frames.length;
    frames.push(frame.sha256);
    if (!(await scrollNear(anchor))) return frames.length;
    await pageSettled(s.page);
  }
}

// Anonymous Drive/Docs link-views render a top-bar sign-in link to Google's
// ServiceLogin/signin endpoints instead of redirecting, so the address alone
// misses the signed-out state. The signed-in avatar is also an
// accounts.google.com anchor (SignOutOptions), so only sign-in links count.
async function isSignedOut() {
  return Boolean(
    await s.page
      .locator('a[href*="ServiceLogin"], a[href*="accounts.google.com/signin"], a[href*="accounts.google.com/v3/signin"]')
      .filter({ visible: true })
      .count(),
  );
}

async function ensureLoggedIn(url) {
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  const onSignIn = new URL(s.page.url()).hostname === GOOGLE_SIGN_IN_HOST;
  if (!onSignIn && !(await isSignedOut())) return;
  if (!onSignIn) {
    await s.page.goto(`https://${GOOGLE_SIGN_IN_HOST}/ServiceLogin?continue=${encodeURIComponent(url)}`, {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(s.page);
  }
  log('signed out; signing in as', creds.email);
  if (!(await googleSso(s, creds))) throw new Error(`DRIVE_EVIDENCE_SIGN_IN_FAILED: Google SSO did not complete at ${s.page.url()}`);
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  if (await isSignedOut()) throw new Error(`DRIVE_EVIDENCE_SIGN_IN_FAILED: still signed out after Google SSO at ${s.page.url()}`);
}

async function captureVersionPanel(meta) {
  // The File menu, not the keyboard chord: Docs binds the chord by the
  // persona's OS and needs editor focus; the menu needs neither.
  await clickDescribed(s.page, "the editor's File menu in its menu bar");
  await clickDescribed(s.page, 'the Version history item in the open File menu');
  await clickDescribed(s.page, 'the See version history item in the open submenu');
  const title = s.page.getByText('Version history', { exact: false }).first();
  await title.waitFor({ state: 'visible' });
  log('  version panel frames:', await scrollSeries(`versions_${meta.id}`, title));
}

try {
  log('folder:', rootMeta.name, '| files:', metas.length);
  await ensureLoggedIn(rootMeta.webViewLink);
  log('folder listing frames:', await scrollSeries('folder_listing', s.page.locator('body')));
  for (const meta of metas) {
    log(meta.name);
    try {
      await s.page.goto(meta.webViewLink, { waitUntil: 'domcontentloaded' });
      await pageSettled(s.page);
      if (await isSignedOut()) throw new SignedOutMidRun(`DRIVE_EVIDENCE_SIGNED_OUT: signed out at ${meta.webViewLink}`);
      await shot(`file_${meta.id}`);
      if (EDITOR_MIMES.has(meta.mimeType)) await captureVersionPanel(meta);
    } catch (error) {
      if (error instanceof SignedOutMidRun) throw error;
      errors.push({ file: meta.id, name: meta.name, at: nowIso(), step: 'capture', error: String(error) });
      log('  ERROR:', String(error));
    }
  }
} finally {
  const manifest = {
    folder_id: rootMeta.id,
    folder_name: rootMeta.name,
    account: creds.email,
    finished_at: nowIso(),
    shot_count: shots.length,
    error_count: errors.length,
    shots,
    errors,
  };
  writeFileSync(OUT_PATH, JSON.stringify(manifest, null, INDENT));
  log('manifest written:', OUT_PATH, '| shots:', shots.length, '| errors:', errors.length);
  await s.close();
}

if (errors.length) {
  process.exitCode = exitStatusFor(new Error('DRIVE_EVIDENCE_PARTIAL'));
  console.error(`PARTIAL: ${shots.length} shots, ${errors.length} files failed (see ${OUT_PATH})`);
} else console.log(`OK: ${shots.length} shots captured, manifest at ${OUT_PATH}`);
