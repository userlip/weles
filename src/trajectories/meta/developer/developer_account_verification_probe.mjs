// Inspect Meta's developer account verification page with an existing Meta
// login profile, keeping its state with the run
// (`_shared/diagnostics/page_state.mjs`): the title, text and visible
// controls as they stand. Clicks nothing.

import { WSession } from '../../../../dist/session/wsession.js';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { keptProfileDir, stableProfilePersona } from '../../_shared/profile/persona.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';

const RUN = 'meta_developer_account_verification_probe';
const USER_DATA_DIR = keptProfileDir('meta_ads');

console.log(
  JSON.stringify({
    stage: 'start',
    userDataDir: USER_DATA_DIR,
    headless: process.env.META_VERIFY_HEADLESS !== '0',
  }),
);

const s = await WSession.start({
  label: RUN,
  proxy: statedProxy('the developer verification probe'),
  persona: stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

try {
  await s.page.goto(
    'https://developers.facebook.com/async/developer/account/verification/',
    { waitUntil: 'domcontentloaded' },
  );
  await recordPageState(s.page, RUN, 'verification_page');
} finally {
  await s.close();
}
