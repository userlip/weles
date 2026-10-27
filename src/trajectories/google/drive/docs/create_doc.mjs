// Create a new Google Doc with a title and a body from a UTF-8 text or
// markdown file, through docs.google.com in a session signed in with the
// dedicated Google Drive login (./document.mjs).
//
// Run:
//   node src/trajectories/google/drive/docs/create_doc.mjs \
//     --title "My doc title" --content /abs/path/to/content.md
// Env mirrors: DOC_TITLE, DOC_CONTENT_PATH; BROWSER pins the engine.
//
// Output: "URL: https://docs.google.com/document/d/<id>/edit" as soon as the
// document exists, so a failed title or body still names the document it
// left; then the title is set and the body typed, and either failing fails
// the run.
import { readFileSync } from 'node:fs';
import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { humanType } from '../../../../../dist/human/keyboard.js';
import { pageSettled, urlMatching } from '../../../_shared/page/settled.mjs';
import { docInput, openSignedInDocs, setDocTitle } from './document.mjs';

const TITLE = docInput(
  '--title',
  ['DOC_TITLE'],
  'the title of the new document',
);
const content = readFileSync(
  docInput(
    '--content',
    ['DOC_CONTENT_PATH'],
    'the file whose text becomes the body',
  ),
  'utf8',
);
const log = (...a) => console.log('[drive_create_doc]', ...a);

// /document/create makes a blank document and redirects to its /edit page.
const s = await openSignedInDocs(
  'drive_create_doc',
  'https://docs.google.com/document/create',
);
try {
  log(
    'engine:',
    s._browserProvenance ? s._browserProvenance.browser : null,
    '| title:',
    TITLE,
    '| content_chars:',
    content.length,
  );
  await urlMatching(s.page, /\/document\/d\/[\w-]+\/edit/);
  console.log(`URL: ${s.page.url()}`);
  await setDocTitle(s.page, TITLE);
  log(`title set: ${TITLE}`);
  const body = s.page
    .locator(
      '.kix-appview-editor, .docs-texteventtarget-iframe, [contenteditable="true"]',
    )
    .first();
  await body.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, body);
  await humanType(s.page, content);
  await pageSettled(s.page);
  log(
    `PASS: doc available at ${s.page.url()} with ${content.length} chars typed`,
  );
} finally {
  await s.close();
}
