// Read the result of a Gmail search from the Google session of the
// persistent real-Chrome profile (launchRealChrome; the session is made once
// with the setup_chrome_profile trajectory).
//
// The search result list is printed, and, unless GM_OPEN=0, GM_MAX threads
// of it are opened and their bodies printed too (./search_result.mjs). A
// profile with no Gmail session, and any thread that cannot be opened, fails
// the run with its cause.
//
// Run:  node src/trajectories/gmail/gmail_search.mjs
// Env:  GM_QUERY  the Gmail search query (required; no mailbox is read
//                 without one)
//       GM_OPEN=0 list only, skip opening thread bodies
//       GM_MAX    how many threads to open; required unless GM_OPEN=0
import { launchRealChrome } from '../../browser/real_chrome.mjs';
import { statedCount, statedText } from '../_shared/inputs/stated.mjs';
import { gmailSearchUrl, printSearchResult, signedInGmail } from './search_result.mjs';

const QUERY = statedText(['GM_QUERY'], 'the Gmail search query to read', 'GMAIL_QUERY_REQUIRED');
const OPEN = process.env.GM_OPEN === '0' ? undefined : statedCount('GM_MAX', 'how many matching threads the search opens and reads');

const log = (...a) => console.log('[gmail_search]', ...a);

const s = await launchRealChrome({ label: 'gmail_search' });
try {
  log('query:', QUERY);
  await s.page.goto(gmailSearchUrl('https://mail.google.com/mail/u/0/', QUERY), { waitUntil: 'domcontentloaded' });
  if (!(await signedInGmail(s.page)))
    throw new Error(
      `GMAIL_SIGNED_OUT: the profile is not signed in to Gmail (url=${s.page.url()}); sign it in once with src/trajectories/_shared/services/setup_chrome_profile.mjs`,
    );
  await printSearchResult(s.page, OPEN, log);
} finally {
  await s.close();
}
