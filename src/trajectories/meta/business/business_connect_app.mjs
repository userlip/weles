// Connect the configured Meta app ID to the current Business portfolio via UI.
// Each control is found by the vision model from its description
// (`_shared/page/judged/seen.mjs`), and the connection counts only once the
// app ID is listed on the portfolio's Apps page. Each step's page state is
// kept with the run (`_shared/diagnostics/page_state.mjs`).

import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';
import {
  BUSINESS_ID,
  businessSettingsUrl,
  startBusinessSession,
} from './business_session.mjs';

const RUN = 'meta_business_connect_app';
const APP_ID = statedText(
  ['META_APP_ID', 'NEXT_PUBLIC_META_ADS_APP_ID'],
  'the Meta app id this run acts on',
);

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

// The id goes into the open dialog's text field, found on the page, so no
// screen position is assumed; the field must then hold exactly the id.
async function fillAppId(page) {
  const field = page
    .locator(
      '[role="dialog"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    )
    .filter({ visible: true })
    .first();
  await field.waitFor({ state: 'visible' });
  await humanClickLocator(page, field);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, APP_ID);
  await pageSettled(page);
  const held = await field.inputValue();
  if (held.trim() !== APP_ID)
    throw new Error(
      `app id field holds ${JSON.stringify(held)}, not ${APP_ID}`,
    );
  console.log(JSON.stringify({ stage: 'filled_app_id', appId: APP_ID }));
}

const s = await startBusinessSession(RUN, 'the Business app connection');
try {
  const apps = businessSettingsUrl('apps');
  await s.page.goto(apps, { waitUntil: 'domcontentloaded' });
  await recordPageState(s.page, RUN, 'initial_apps');
  await clickControl(
    s.page,
    'add',
    'the enabled button that adds an app on the Apps page of Business Settings',
  );
  await recordPageState(s.page, RUN, 'add_menu');
  await clickControl(
    s.page,
    'connect_app_id',
    'the option in the open Add menu that connects an existing app by its app ID',
  );
  await recordPageState(s.page, RUN, 'connect_app_form');
  await fillAppId(s.page);
  await recordPageState(s.page, RUN, 'app_id_filled');
  await clickControl(
    s.page,
    'submit_app_id',
    'the enabled button that submits the app ID in the open dialog (not the one that closes or cancels it)',
  );
  await recordPageState(s.page, RUN, 'after_submit');
  if (
    await pageShows(
      s.page,
      'Does the page show an error or a refusal of the app connection?',
    )
  ) {
    throw new Error(
      `Meta refused or failed the connection of app ${APP_ID}; the page as it answered is recorded as after_submit`,
    );
  }
  await s.page.goto(apps, { waitUntil: 'domcontentloaded' });
  const listed = await recordPageState(s.page, RUN, 'apps_after_submit');
  if (!listed.text.includes(APP_ID))
    throw new Error(
      `the connection was submitted but app ${APP_ID} is not listed on the portfolio's Apps page`,
    );
  console.log(
    `PASS: Meta app ${APP_ID} is connected to business ${BUSINESS_ID}`,
  );
} finally {
  await s.close();
}
