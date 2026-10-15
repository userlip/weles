// What the Google Docs trajectories share: their inputs (a --flag or its
// environment mirror), a Chromium session signed in to Google Docs with the
// dedicated Google Drive login, a document's id from its address, and
// setting a document's title through the editor's own title field.
//
// Chromium is the engine unless BROWSER names another: Docs draws the title
// and body as canvas-backed controls Firefox's session cannot resolve.
import { WSession } from '../../../../../dist/session/wsession.js';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
import { googleSso } from '../../../_shared/services/google_sso.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { onGoogleSignIn } from '../../../_shared/profile/google_session.mjs';
import { readScopedLogin } from '../../../../_shared/scoped-secrets.mjs';

/** The value after `flag` on the command line, else the first of the environment's `envs` set; refused by name when none is given. */
export function docInput(flag, envs, what) {
  let value = envs.map((name) => process.env[name]).find(Boolean);
  if (process.argv.includes(flag)) [, value] = process.argv.slice(process.argv.indexOf(flag));
  if (!value) throw new Error(`${flag} (or ${envs.join(' / ')}) is required: ${what}`);
  return value;
}

/** The document id an address (/document/d/<id>/…) or a bare id names. */
export function documentId(input) {
  const fromAddress = input.match(/\/document\/d\/(?<id>[\w-]+)/)?.groups.id;
  if (fromAddress) return fromAddress;
  if (/^[\w-]+$/.test(input)) return input;
  throw new Error(`DRIVE_DOCUMENT_ID_UNREAD: "${input}" is neither a Google Docs address nor a document id`);
}

/** A session on `url`, signed in to Google Docs; a sign-in that does not complete throws. */
export async function openSignedInDocs(label, url) {
  const creds = readScopedLogin('googleDrive');
  const s = await WSession.start({ label, browser: process.env.BROWSER ? process.env.BROWSER : 'chromium' });
  try {
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await pageSettled(s.page);
    if (onGoogleSignIn(s.page.url())) {
      console.log(`[${label}] logged out — running googleSso for ${creds.email}`);
      if (!(await googleSso(s, creds))) throw new Error(`DRIVE_DOCUMENT_SIGN_IN_FAILED: ${s.page.url()}`);
      await s.page.goto(url, { waitUntil: 'domcontentloaded' });
      await pageSettled(s.page);
    }
    return s;
  } catch (error) {
    await s.close();
    throw error;
  }
}

/**
 * Set the open document's title: the title display is clicked, which puts
 * the focused title input in its place; its text is selected and replaced
 * by `title` (Docs intercepts the select-all and delete keys there, and only
 * typed characters land), Enter commits it, and the rendered title must then
 * read `title`.
 */
export async function setDocTitle(page, title) {
  const display = page.locator('.docs-title-input-label-inner, .docs-title-input-label').filter({ visible: true }).first();
  await display.waitFor({ state: 'visible' });
  await humanClickLocator(page, display);
  const input = page.locator('input.docs-title-input');
  await input.waitFor({ state: 'visible' });
  await page.evaluate(() => {
    // allow-raw-playwright: selection of the already-focused title input, no click/focus/dispatch
    const field = document.querySelector('input.docs-title-input');
    if (document.activeElement !== field)
      throw new Error('DRIVE_DOCUMENT_TITLE_FOCUS_LOST: the title input is not focused after the click');
    field.select();
  });
  await humanType(page, title);
  if ((await input.inputValue()) !== title)
    throw new Error('DRIVE_DOCUMENT_TITLE_VALUE_MISMATCH: the title input differs from the requested title');
  await page.keyboard.press('Enter'); // allow-raw-playwright: commit-title Enter press
  await pageSettled(page);
  const shown = (await display.textContent()).trim();
  if (shown !== title)
    throw new Error(`DRIVE_DOCUMENT_TITLE_NOT_COMMITTED: the title reads ${JSON.stringify(shown)}, not ${JSON.stringify(title)}`);
}
