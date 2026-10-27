// Inspect Accounts Center contact info for Meta developer phone verification.
// Keeps each step's page state with the run (`_shared/diagnostics/page_state.mjs`)
// and clicks only navigation/contact-info controls, each found by the vision
// model from its description (`_shared/page/judged/seen.mjs`) in the
// account's language. A failed step is thrown with its cause.

import { WSession } from '../../../../dist/session/wsession.js';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import {
  keptProfileDir,
  stableProfilePersona,
} from '../../_shared/profile/persona.mjs';
import { bringBrowserToFront } from '../../_shared/action/window.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';

const RUN = 'meta_accounts_center_contact_info_probe';
const USER_DATA_DIR = keptProfileDir('meta_ads');

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

console.log(
  JSON.stringify({
    stage: 'start',
    userDataDir: USER_DATA_DIR,
    headless: process.env.META_VERIFY_HEADLESS === '1',
  }),
);

const s = await WSession.start({
  label: RUN,
  proxy: statedProxy('the Accounts Center contact-info probe'),
  persona: stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

try {
  await bringBrowserToFront(s, RUN);
  await s.page.goto('https://accountscenter.facebook.com/', {
    waitUntil: 'domcontentloaded',
  });
  await recordPageState(s.page, RUN, 'accounts_center_initial');
  await clickControl(
    s.page,
    'contact_info',
    'the Accounts Center entry that opens the contact information settings',
  );
  await recordPageState(s.page, RUN, 'contact_info');
  await clickControl(
    s.page,
    'existing_phone',
    'the listed phone number in the contact information settings',
  );
  await recordPageState(s.page, RUN, 'existing_phone');
} finally {
  await s.close();
}
