// Search Meta owner/approval surfaces of the stated portfolio, ad account and
// app, and complete any exposed safe approval steps. Whether a surface offers
// an approval, an activation, a request tab or a confirmation is judged by the
// vision model, and the control it names is clicked
// (`_shared/page/judged/seen.mjs`); nothing here reads one language's button
// words, and the model is told never to pick a cancel, delete, leave or
// transfer control. Only surfaces of the stated portfolio, ad account and app
// are visited. Each step's page state is kept with the run
// (`_shared/diagnostics/page_state.mjs`).

import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';
import {
  BUSINESS_ID,
  businessSettingsUrl,
  startBusinessSession,
} from './business_session.mjs';

const RUN = 'meta_business_approval_autopilot';
const NEVER =
  'Never a control that cancels, deletes, removes, leaves or transfers anything.';
const AD_ACCOUNT_ID = statedText(
  ['AD_ACCOUNT_ID', 'META_AD_ACCOUNT_ID'],
  'the Meta ad account id this run acts on',
).replace(/^act_/, '');
const APP_ID = statedText(['META_APP_ID'], 'the Meta app id this run acts on');

/** Clicks what `description` names when the page shows what `question` asks. */
async function clickWhenShown(page, label, question, description) {
  if (!(await pageShows(page, `${question} ${NEVER}`))) return false;
  const target = await clickDescribed(page, `${description}. ${NEVER}`);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
  return true;
}

async function confirmWhenAsked(page, label) {
  await clickWhenShown(
    page,
    `${label}_confirm`,
    'Is a dialog open asking to confirm the action just taken?',
    'the button in the open dialog that confirms the action',
  );
}

async function tryApproveOrActivate(page, label) {
  if (
    await clickWhenShown(
      page,
      `${label}:approve`,
      'Is there an enabled control that approves or accepts a pending access request?',
      'the enabled control that approves or accepts the pending access request',
    )
  ) {
    await confirmWhenAsked(page, `${label}:approve`);
    return 'approval_clicked';
  }
  if (
    await clickWhenShown(
      page,
      `${label}:activate`,
      'Is there an enabled control that activates or reactivates the app or switches it to live?',
      'the enabled control that activates the app or switches it to live',
    )
  ) {
    await confirmWhenAsked(page, `${label}:activate`);
    return 'activate_clicked';
  }
  return null;
}

/** The request lists Business Settings shows as tabs, by what each holds. */
const REQUEST_TABS = [
  { tab: 'needs_review', holds: 'requests that need your review' },
  { tab: 'sent', holds: 'requests you sent' },
  { tab: 'completed', holds: 'completed requests' },
];

const legacyRequests = new URL('https://business.facebook.com/settings/requests');
legacyRequests.searchParams.set('business_id', BUSINESS_ID);
const pendingAdAccounts = new URL(businessSettingsUrl('ad_accounts/'));
pendingAdAccounts.searchParams.set('selected_asset_type', 'ad-account');
const accountSettings = new URL(
  'https://business.facebook.com/ads/manager/account_settings/',
);
accountSettings.searchParams.set('act', AD_ACCOUNT_ID);
const adsManager = new URL(
  'https://business.facebook.com/adsmanager/manage/campaigns',
);
adsManager.searchParams.set('act', AD_ACCOUNT_ID);

// The surfaces visited, in order; `requests` marks the request lists whose
// tabs are opened.
const SURFACES = [
  {
    label: 'business_requests',
    url: businessSettingsUrl('requests'),
    requests: true,
  },
  {
    label: 'legacy_business_requests',
    url: legacyRequests.toString(),
    requests: true,
  },
  { label: 'business_ad_account_pending', url: pendingAdAccounts.toString() },
  { label: 'ads_account_settings_act', url: accountSettings.toString() },
  { label: 'ads_manager_act', url: adsManager.toString() },
  {
    label: 'developer_app',
    url: `https://developers.facebook.com/apps/${encodeURIComponent(APP_ID)}/dashboard/`,
  },
];

const s = await startBusinessSession(RUN, 'the Business approval autopilot');
const actions = [];
try {
  for (const { label, url, requests } of SURFACES) {
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await recordPageState(s.page, RUN, label);
    const action = await tryApproveOrActivate(s.page, label);
    if (action) {
      actions.push({ label, action });
      await recordPageState(s.page, RUN, `${label}.after_action`);
    }
    if (!requests) continue;
    for (const { tab, holds } of REQUEST_TABS) {
      const opened = await clickWhenShown(
        s.page,
        `${label}:${tab}`,
        `Is there a tab listing ${holds}?`,
        `the tab listing ${holds}`,
      );
      if (!opened) continue;
      const listed = await recordPageState(s.page, RUN, `${label}.${tab}`);
      const tabAction = await tryApproveOrActivate(s.page, `${label}:${tab}`);
      if (tabAction) {
        actions.push({ label: `${label}:${tab}`, action: tabAction });
        await recordPageState(s.page, RUN, `${label}.${tab}.after_action`);
      }
      if (listed.text.includes(AD_ACCOUNT_ID)) {
        const target = await clickDescribed(
          s.page,
          `the request row for ad account ${AD_ACCOUNT_ID}. ${NEVER}`,
        );
        console.log(
          JSON.stringify({
            stage: 'clicked',
            label: `${label}:${tab}:open_request`,
            ...target,
          }),
        );
        await recordPageState(s.page, RUN, `${label}.${tab}.request_opened`);
      }
    }
  }
  console.log(JSON.stringify({ stage: 'actions', actions }));
  console.log(
    actions.length
      ? 'PASS: approval autopilot executed exposed Meta controls'
      : 'PASS: approval autopilot found no exposed approval or activation controls in the current Weles Meta session',
  );
} finally {
  await s.close();
}
