// Probe Meta Business Suite's portfolio switcher with a logged-in Weles profile.
// The switcher is found by the vision model from its description
// (`_shared/page/judged/seen.mjs`) instead of a guessed point and a score over
// the words of one language and one business name. Each step's page state is
// kept with the run (`_shared/diagnostics/page_state.mjs`), and the business
// portfolios its links name are logged.

import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { recordPageState } from '../../../_shared/diagnostics/page_state.mjs';
import {
  businessSettingsUrl,
  linkedBusinessIds,
  startBusinessSession,
} from '../business_session.mjs';

const RUN = 'meta_business_switcher_probe';

async function step(page, name) {
  const state = await recordPageState(page, RUN, name);
  console.log(
    JSON.stringify({ stage: name, businessIds: linkedBusinessIds(state) }),
  );
}

const s = await startBusinessSession(RUN, 'the Business switcher probe');
try {
  await s.page.goto(businessSettingsUrl('business_users'), {
    waitUntil: 'domcontentloaded',
  });
  await step(s.page, 'before_switcher');
  const target = await clickDescribed(
    s.page,
    'the business portfolio selector that switches between business portfolios, near the top left of Meta Business Suite',
  );
  console.log(JSON.stringify({ stage: 'clicked_switcher', ...target }));
  await step(s.page, 'after_switcher');
} finally {
  await s.close();
}
