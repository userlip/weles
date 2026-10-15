// Gmail login + search trajectory (self-contained, no pre-seeded profile).
//
// Unlike gmail_search.mjs (which reads the Google session of the persistent
// real-Chrome profile), this signs in from scratch with the stated Gmail
// credentials in a full WSession (patched Chromium or weles-firefox), then
// reads the search result through ./search_result.mjs.
//
// Flow: open the mailbox -> Google sign-in when Gmail asks for it (the
// account chooser's "use another account" first, when shown) -> dismiss the
// post-login speedbump -> #search/<query> -> the result list -> the bodies of
// GM_MAX threads.
//
// Run:  node src/trajectories/gmail/gmail_login_search.mjs
//       GM_QUERY      required nonempty Gmail search query
//       GM_OPEN=0     list only, skip opening thread bodies
//       GM_MAX        how many threads to open; required unless GM_OPEN=0
//       GM_CREDENTIAL_SERVICE  the scoped login read; Gmail's own when unstated
//       BROWSER       'firefox' | 'chromium' to pin the engine (rolled otherwise)
import { WSession } from '../../../dist/session/wsession.js';
import { googleSso } from '../_shared/services/google_sso.mjs';
import { dismissGooglePostLogin } from '../_shared/services/google_sso/sign_in/redirect_watch.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import { statedCount, statedText } from '../_shared/inputs/stated.mjs';
import { gmailSearchUrl, printSearchResult, signedInGmail } from './search_result.mjs';

const QUERY = statedText(['GM_QUERY'], 'the Gmail search query to read', 'GMAIL_QUERY_REQUIRED');
const OPEN = process.env.GM_OPEN === '0' ? undefined : statedCount('GM_MAX', 'how many matching threads the search opens and reads');
// The stated credential service is read as given; the scoped-secret catalog
// refuses one it does not declare. A run that states none reads Gmail's.
const CREDENTIAL_SERVICE =
  process.env.GM_CREDENTIAL_SERVICE === undefined ? 'gmail' : process.env.GM_CREDENTIAL_SERVICE;

const log = (...a) => console.log('[gmail_login_search]', ...a);

const creds = readScopedLogin(CREDENTIAL_SERVICE);
const mailbox = `https://mail.google.com/mail/u/0/?tab=rm&ogbl&authuser=${encodeURIComponent(creds.email)}`;
const s = await WSession.start({ label: 'gmail_login_search', browser: process.env.BROWSER });
try {
  log('engine:', s._browserProvenance ? s._browserProvenance.browser : null, '| query:', QUERY);
  await s.page.goto(`${mailbox}#inbox`, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  // Gmail sends a signed-out session to Google's sign-in (or shows its
  // identifier field); a signed-in one stays on Gmail.
  const identifier = s.page.locator('input[type="email"], input[name="identifier"], input#identifierId');
  if (new URL(s.page.url()).hostname !== 'mail.google.com' || (await identifier.count())) {
    if (await clickOffered(s.page, 'the account chooser option to use another account')) await pageSettled(s.page);
    log('logged out — running googleSso for', creds.email);
    if (!(await googleSso(s, creds)))
      throw new Error(`GMAIL_SIGN_IN_INCOMPLETE: Google sign-in for ${creds.email} did not complete (url=${s.page.url()})`);
    await dismissGooglePostLogin(s.page);
    log('signed in, at ' + s.page.url());
  } else log('already signed in (existing session)');

  await s.page.goto(gmailSearchUrl(mailbox, QUERY), { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  if (!(await signedInGmail(s.page)))
    throw new Error(`GMAIL_SEARCH_NOT_SHOWN: the search did not open in signed-in Gmail (url=${s.page.url()})`);
  await printSearchResult(s.page, OPEN, log);
  log('done.');
} finally {
  await s.close();
}
