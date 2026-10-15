// Search Google Drive for files matching a query string.
//
// Run:
//   node weles/src/trajectories/google/drive/search.mjs --q "grantland"
//
// Env mirror: GD_QUERY. GD_LIMIT (required): how many results to return.
//
// Output: JSON array on stdout with each result's title, url, fileId and the
// type label Drive gives its icon. A file's url is Drive's own opener, which
// sends it to the editor its type uses. Whether an empty result list is
// Drive's "no matches" answer is judged by the vision model; a page showing
// neither results nor that answer is refused with its address.

import { parseArgs } from 'node:util';
import { WSession } from '../../../../dist/session/wsession.js';
import { googleSso } from '../../_shared/services/google_sso.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { pageShows } from '../../_shared/page/judged/seen.mjs';
import { readScopedLogin } from '../../../_shared/scoped-secrets.mjs';
import { statedCount } from '../../_shared/inputs/stated.mjs';
import { onGoogleSignIn } from '../../_shared/profile/google_session.mjs';

const INDENT = '  ';
const { values: args } = parseArgs({
  options: { q: { type: 'string' } },
  strict: false,
});
const QUERY = args.q || process.env.GD_QUERY;
const LIMIT = statedCount('GD_LIMIT', 'how many Drive results the search returns');
const LABEL = 'drive_search';

if (!QUERY) {
  throw new Error('DRIVE_SEARCH_QUERY_REQUIRED: --q (or GD_QUERY) names the search');
}

function log(...a) {
  console.log('[drive_search]', ...a);
}

/** Every distinct file row the Drive result list shows, read in the page. */
function resultRows() {
  const seen = new Set();
  const out = [];
  for (const row of document.querySelectorAll('[data-id]')) {
    const id = row.getAttribute('data-id');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Drive names a row in its aria-label (the name before the first comma)
    // or in a child's tooltip.
    const label = row.getAttribute('aria-label');
    const tooltip = row.querySelector('[data-tooltip]');
    const [named] = label ? label.split(',') : [];
    const icon = row.querySelector('[role="img"][aria-label]');
    out.push({
      fileId: id,
      title: named
        ? named.trim()
        : tooltip
          ? tooltip.getAttribute('data-tooltip').trim()
          : null,
      typeLabel: icon ? icon.getAttribute('aria-label') : null,
      url: `https://drive.google.com/open?id=${encodeURIComponent(id)}`,
    });
  }
  return out;
}

const creds = readScopedLogin('googleDrive');
// Chromium is the engine: Firefox stalls at Google's password challenge page.
const s = await WSession.start({ label: LABEL, browser: 'chromium' });

try {
  log(
    'engine:',
    s._browserProvenance ? s._browserProvenance.browser : null,
    '| query:',
    QUERY,
  );
  const url = `https://drive.google.com/drive/search?q=${encodeURIComponent(QUERY)}`;
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);

  if (onGoogleSignIn(s.page.url())) {
    log('logged out — running googleSso for', creds.email);
    if (!(await googleSso(s, creds)))
      throw new Error(`DRIVE_SEARCH_SIGN_IN_FAILED: ${s.page.url()}`);
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await pageSettled(s.page);
  }
  if (onGoogleSignIn(s.page.url())) {
    throw new Error(`DRIVE_SEARCH_SIGN_IN_REQUIRED: ${s.page.url()}`);
  }

  const rows = await s.page.evaluate(resultRows);
  if (!rows.length) {
    if (
      !(await pageShows(
        s.page,
        'Does the page say that no files match the search?',
      ))
    )
      throw new Error(
        `DRIVE_SEARCH_RESULTS_UNREAD: the page shows neither results nor a no-match answer at ${s.page.url()}`,
      );
    log('MATCHES: 0');
    console.log('[]');
  } else {
    const limited = rows.filter((row, index) => index < LIMIT);
    log(`MATCHES: ${limited.length}`);
    console.log(JSON.stringify(limited, null, INDENT));
  }
} finally {
  await s.close();
}
