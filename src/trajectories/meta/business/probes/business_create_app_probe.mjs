// Probe Meta Business Settings' app creation form without submitting it. The
// Add control and the create-app option are found by the vision model from
// their description (`_shared/page/judged/seen.mjs`), in whatever language the
// account's Business Settings speak; each page's state is kept with the run
// (`_shared/diagnostics/page_state.mjs`).

import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { recordPageState } from '../../../_shared/diagnostics/page_state.mjs';
import {
  businessSettingsUrl,
  startBusinessSession,
} from '../business_session.mjs';

const RUN = 'meta_business_create_app_probe';

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

const s = await startBusinessSession(RUN, 'the Business create-app probe');
try {
  await s.page.goto(businessSettingsUrl('apps'), {
    waitUntil: 'domcontentloaded',
  });
  await recordPageState(s.page, RUN, 'apps_initial');
  await clickControl(
    s.page,
    'add',
    'the enabled button that adds an app on the Apps page of Business Settings',
  );
  await recordPageState(s.page, RUN, 'add_menu');
  await clickControl(
    s.page,
    'create_app_id',
    'the option in the open Add menu that creates a new app ID',
  );
  await recordPageState(s.page, RUN, 'create_app_form');
} finally {
  await s.close();
}
