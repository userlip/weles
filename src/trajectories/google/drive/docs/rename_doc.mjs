// Rename an existing Google Doc through its editor's own title field
// (./document.mjs). The rendered title must read the new title after the
// commit; that is the editor's state, not proof the server kept it.
//
// Run:
//   node src/trajectories/google/drive/docs/rename_doc.mjs \
//     --doc https://docs.google.com/document/d/<id>/edit --title "New title"
// Env mirrors: DOC_URL, DOC_TITLE; BROWSER pins the engine.
import { docInput, documentId, openSignedInDocs, setDocTitle } from './document.mjs';

const DOC_ID = documentId(docInput('--doc', ['DOC_URL'], 'the document to rename'));
const TITLE = docInput('--title', ['DOC_TITLE'], 'the new title');

const s = await openSignedInDocs('drive_rename_doc', `https://docs.google.com/document/d/${DOC_ID}/edit`);
try {
  await setDocTitle(s.page, TITLE);
  console.log(`RENAMED: ${TITLE}`);
} finally {
  await s.close();
}
