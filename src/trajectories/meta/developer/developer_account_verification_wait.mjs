// Open Meta developer account verification visibly and wait for the user to
// complete Meta-controlled registration/verification. Does not accept terms or
// submit phone/card data on behalf of the user. Completion is read from Meta's
// own routes: the run waits until the page has left the verification and
// registration-dialog paths, not until some words disappear. The final page's
// state is kept with the run (`_shared/diagnostics/page_state.mjs`).

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageCondition } from '../../_shared/page/settled.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';
import { bringBrowserToFront } from '../../_shared/action/window.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';

const RUN = 'meta_developer_account_verification_wait';
const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
mkdirSync(USER_DATA_DIR, { recursive: true });

// Meta's verification and registration-dialog paths.
const VERIFICATION_PATHS = ['/account/verification', '/registration/dialog'];

console.log(JSON.stringify({ stage: 'start', userDataDir: USER_DATA_DIR }));

const s = await WSession.start({
  label: RUN,
  proxy: statedProxy('the developer verification wait'),
  persona: stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
  headless: false,
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

try {
  await bringBrowserToFront(s, RUN);
  await s.page.goto(
    'https://developers.facebook.com/async/developer/account/verification/',
    { waitUntil: 'domcontentloaded' },
  );
  await bringBrowserToFront(s, RUN);
  // The operator completes the registration in this window; the run waits
  // until the page has left Meta's verification and registration paths, for
  // as long as that takes, and is ended by cancellation otherwise.
  await pageCondition(
    s.page,
    (paths) => !paths.some((path) => location.pathname.includes(path)),
    VERIFICATION_PATHS,
  );
  await recordPageState(s.page, RUN, 'final');
  console.log(
    'PASS: developer registration/verification flow no longer blocks this profile',
  );
} finally {
  await s.close();
}
