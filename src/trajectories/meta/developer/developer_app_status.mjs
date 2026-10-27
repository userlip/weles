// Meta developer app status inspector.
//
// Uses a Weles browser session with an existing Meta login profile and keeps
// the state of the Meta developer app dashboard and settings pages with the
// run (`_shared/diagnostics/page_state.mjs`): the title, text and visible
// controls as they stand. The app's mode is read from that record, not
// guessed here from the words one language prints.

import { WSession } from '../../../../dist/session/wsession.js';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import {
  keptProfileDir,
  stableProfilePersona,
} from '../../_shared/profile/persona.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';

const RUN = 'meta_developer_app_status';
const APP_ID = statedText(
  ['META_APP_ID', 'NEXT_PUBLIC_META_ADS_APP_ID'],
  'the Meta app id this run acts on',
);
const USER_DATA_DIR = keptProfileDir('meta_ads');

const app = `https://developers.facebook.com/apps/${encodeURIComponent(APP_ID)}`;
// The app's pages read, by name and address.
const PAGES = [
  ['dashboard', `${app}/dashboard/`],
  ['basic_settings', `${app}/settings/basic/`],
  ['app_review', `${app}/app-review/permissions/`],
  ['roles', `${app}/roles/roles/`],
];

console.log(
  JSON.stringify({
    stage: 'start',
    appId: APP_ID,
    userDataDir: USER_DATA_DIR,
    headless: process.env.META_DEV_HEADLESS !== '0',
  }),
);

const s = await WSession.start({
  label: RUN,
  proxy: statedProxy('the developer app status read'),
  persona: stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_DEV_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

try {
  for (const [name, url] of PAGES) {
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await recordPageState(s.page, RUN, name);
  }
} finally {
  await s.close();
}
