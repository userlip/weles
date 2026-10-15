// Probe the non-submitting Add flow for Meta Business Settings assets. The Add
// control is found by the vision model from its description
// (`_shared/page/judged/seen.mjs`), in the account's language. Each step's
// page state is kept with the run (`_shared/diagnostics/page_state.mjs`).

import { statedChoice } from '../../../_shared/inputs/stated.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { recordPageState } from '../../../_shared/diagnostics/page_state.mjs';
import {
  businessSettingsUrl,
  startBusinessSession,
} from '../business_session.mjs';

// The Business Settings page of each asset kind.
const pagePaths = Object.freeze({
  apps: 'apps',
  ad_accounts: 'ad_accounts',
  system_users: 'system_users',
});
const ASSET_KIND = statedChoice(
  ['META_ASSET_KIND'],
  pagePaths,
  'the Business asset kind the probe adds',
);
const RUN = `meta_business_add_${ASSET_KIND}_probe`;

const s = await startBusinessSession(RUN, 'the Business add-asset probe');
try {
  await s.page.goto(businessSettingsUrl(pagePaths[ASSET_KIND]), {
    waitUntil: 'domcontentloaded',
  });
  await recordPageState(s.page, RUN, 'before_add');
  const target = await clickDescribed(
    s.page,
    `the enabled button that adds a new item to the ${ASSET_KIND.replace('_', ' ')} list of Business Settings`,
  );
  console.log(JSON.stringify({ stage: 'clicked_add', ...target }));
  await recordPageState(s.page, RUN, 'after_add');
} finally {
  await s.close();
}
