// Request non-transfer access to an existing Meta ad account from Business
// Settings. Each control - Add, the access-request option, Next, the role and
// the confirmation - is found by the vision model from its description, and
// each state the flow branches on - a refusal, a role still to choose, the
// dialog still open - is judged by it (`_shared/page/judged/seen.mjs`), in the
// language the account's Business Settings speak. Each step's page state is
// kept with the run (`_shared/diagnostics/page_state.mjs`).

import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';
import {
  businessSettingsUrl,
  startBusinessSession,
} from './business_session.mjs';

const RUN = 'meta_business_request_ad_account_access';
const NEVER =
  'Never a control that cancels, closes, transfers or creates a new ad account.';
const AD_ACCOUNT_ID = statedText(
  ['AD_ACCOUNT_ID', 'META_AD_ACCOUNT_ID'],
  'the Meta ad account id this run acts on',
).replace(/^act_/, '');

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, `${description}. ${NEVER}`);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

/** Refuses when Meta shows an error or a refusal; `step` names the page record. */
async function refuseOnError(page, step) {
  if (
    await pageShows(
      page,
      'Does the page show an error, a refusal of access, or a message that the ad account ID is missing or invalid?',
    )
  )
    throw new Error(
      `Meta refused or failed the ad-account access request for ${AD_ACCOUNT_ID}; the page as it answered is recorded as ${step}`,
    );
}

// The id goes into the open dialog's text field, found on the page, so no
// screen position is assumed. A request sent with another id asks access to
// someone else's account, so the field must hold exactly the id.
async function fillAdAccountId(page) {
  const field = page
    .locator(
      '[role="dialog"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    )
    .filter({ visible: true })
    .first();
  await field.waitFor({ state: 'visible' });
  await humanClickLocator(page, field);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, AD_ACCOUNT_ID);
  await pageSettled(page);
  const held = await field.inputValue();
  if (held.trim() !== AD_ACCOUNT_ID)
    throw new Error(
      `ad account id field holds ${JSON.stringify(held)}, not ${AD_ACCOUNT_ID}`,
    );
  console.log(
    JSON.stringify({ stage: 'filled_ad_account_id', adAccountId: AD_ACCOUNT_ID }),
  );
}

const s = await startBusinessSession(RUN, 'the ad-account access request');
try {
  await s.page.goto(businessSettingsUrl('ad_accounts'), {
    waitUntil: 'domcontentloaded',
  });
  await recordPageState(s.page, RUN, 'initial_ad_accounts');
  await clickControl(
    s.page,
    'add',
    'the enabled button that adds an ad account on the Ad accounts page of Business Settings',
  );
  await recordPageState(s.page, RUN, 'add_menu');
  await clickControl(
    s.page,
    'request_access',
    'the option in the open Add menu that requests access to an existing ad account',
  );
  await recordPageState(s.page, RUN, 'request_form');
  await fillAdAccountId(s.page);
  await recordPageState(s.page, RUN, 'ad_account_id_filled');
  await clickControl(
    s.page,
    'next_or_submit',
    'the enabled button that moves the open access request dialog to its next step or sends it',
  );
  await recordPageState(s.page, RUN, 'after_submit');
  await refuseOnError(s.page, 'after_submit');
  let last = 'after_submit';
  if (
    await pageShows(
      s.page,
      'Does the open dialog ask to choose the role or access level being requested?',
    )
  ) {
    await clickControl(
      s.page,
      'select_role',
      'the switch or option that requests full control to manage the ad account, unless it is already on',
    );
    await recordPageState(s.page, RUN, 'role_selected');
    await clickControl(
      s.page,
      'confirm_request',
      'the enabled button that confirms and sends the access request',
    );
    await recordPageState(s.page, RUN, 'after_confirm');
    await refuseOnError(s.page, 'after_confirm');
    last = 'after_confirm';
  }
  if (
    await pageShows(
      s.page,
      'Is the dialog for requesting access to an ad account still open, without a message that the request was sent?',
    )
  )
    throw new Error(
      `Meta kept the ad-account request dialog open for ${AD_ACCOUNT_ID}; the page is recorded as ${last}`,
    );
  console.log('PASS: Meta ad-account access request flow submitted');
} finally {
  await s.close();
}
