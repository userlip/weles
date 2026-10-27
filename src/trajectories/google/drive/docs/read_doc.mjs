// Read the plain-text body of an existing Google Doc through Docs' own
// /export?format=txt endpoint, fetched with the signed-in session's cookies
// (./document.mjs), rather than scraping the canvas-rendered editor.
//
// Run:
//   node src/trajectories/google/drive/docs/read_doc.mjs --doc <url-or-id> [--out path]
// Env mirrors: DOC_URL (or DOC_ID); BROWSER pins the engine. Without --out
// the text is written to stdout.
import { writeFileSync } from 'node:fs';
import { docInput, documentId, openSignedInDocs } from './document.mjs';

const DOC_ID = documentId(
  docInput('--doc', ['DOC_URL', 'DOC_ID'], 'the document to read'),
);
const OUT_PATH = process.argv.includes('--out')
  ? docInput('--out', [], 'the file the text is written to')
  : null;
const log = (...a) => console.error('[drive_read_doc]', ...a);

const s = await openSignedInDocs(
  'drive_read_doc',
  'https://docs.google.com/document/u/0/',
);
try {
  const exportUrl = `https://docs.google.com/document/d/${DOC_ID}/export?format=txt`;
  log('fetching:', exportUrl);
  const response = await s.page.context().request.get(exportUrl); // allow-raw-playwright: read-only export HTTP fetch via the page's authenticated context
  if (!response.ok())
    throw new Error(
      `DRIVE_DOCUMENT_EXPORT_HTTP_ERROR: HTTP ${response.status()} for ${exportUrl}`,
    );
  const body = await response.text();
  if (OUT_PATH) {
    writeFileSync(OUT_PATH, body);
    console.log(`OK: wrote ${body.length} chars to ${OUT_PATH}`);
  } else process.stdout.write(body);
} finally {
  await s.close();
}
