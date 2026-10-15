import { pageSettled } from '../../../_shared/page/settled.mjs';
import {
  clickDescribed,
  fillDescribed,
  pageShows,
} from '../../../_shared/page/judged/seen.mjs';
// The fields the draft carries, and the proof they are in it.
//
// One pass down the campaign, ad set and ad steps: names, budget, the Facebook
// Page the ad runs from, the destination the click leads to, and the creative
// text. The count it returns is how many of the requested fields were actually
// written - the run refuses when that count is zero. The verification at the
// end re-reads the Review tab and refuses if a value the operator asked for is
// not on it.

import {
  AD_NAME,
  AD_SET_NAME,
  CAMPAIGN_NAME,
  DAILY_BUDGET_USD,
  DESCRIPTION,
  DESTINATION_URL,
  DISPLAY_LINK,
  FACEBOOK_PAGE_ID,
  FACEBOOK_PAGE_NAME,
  HEADLINE,
  PRIMARY_TEXT,
  URL_PARAMS,
} from './campaign_request.mjs';
import { pageText } from './panel_controls.mjs';

async function selectFacebookPage(s) {
  if (!FACEBOOK_PAGE_NAME && !FACEBOOK_PAGE_ID) return false;
  const page = FACEBOOK_PAGE_NAME
    ? `the Facebook Page named "${FACEBOOK_PAGE_NAME}"`
    : `the Facebook Page with ID ${FACEBOOK_PAGE_ID}`;
  if (
    await pageShows(
      s.page,
      `Is ${page} already selected as this ad's identity?`,
    )
  ) {
    console.log(`[meta-ads] Facebook Page already selected: ${page}`);
    return true;
  }
  await clickDescribed(s.page, "the selector of the ad's Facebook Page");
  await clickDescribed(s.page, `the option for ${page} in the open list`);
  console.log(`[meta-ads] selected ${page}`);
  return true;
}

/** Fills the field `description` names with `value` when the run states one. */
async function fillStated(s, description, value) {
  if (!value) return false;
  await fillDescribed(s.page, description, value);
  console.log(`[meta-ads] filled: ${description}`);
  return true;
}

async function nextStep(s) {
  await clickDescribed(
    s.page,
    'the enabled Next button that moves the campaign editor to its next step',
  );
  await pageSettled(s.page);
}

async function fillCampaignFields(s) {
  const steps = [
    [['the campaign name field', CAMPAIGN_NAME]],
    [
      ['the ad set name field', AD_SET_NAME],
      ['the daily budget field of the ad set', DAILY_BUDGET_USD],
    ],
    [
      ['the ad name field', AD_NAME],
      ['the website URL field of the ad destination', DESTINATION_URL],
      ['the display link field of the ad', DISPLAY_LINK],
      ['the URL parameters field of the ad', URL_PARAMS],
      ['the primary text field of the ad creative', PRIMARY_TEXT],
      ['the headline field of the ad creative', HEADLINE],
      ['the description field of the ad creative', DESCRIPTION],
    ],
  ];
  const filled = [];
  for (const [index, fields] of steps.entries()) {
    if (index) await nextStep(s);
    for (const [description, value] of fields) if (await fillStated(s, description, value)) filled.push(description);
  }
  if (await selectFacebookPage(s)) filled.push('the Facebook Page');
  return filled.length;
}

async function verifyConfiguredDraft(s) {
  await clickDescribed(
    s.page,
    'the Review tab of the campaign editor, which summarises the draft',
  );
  const text = await pageText(s);
  const checks = [
    [CAMPAIGN_NAME, 'campaign name'],
    [AD_SET_NAME, 'ad set name'],
    [AD_NAME, 'ad name'],
    [FACEBOOK_PAGE_NAME, 'Facebook Page'],
    [DESTINATION_URL, 'destination URL'],
  ].filter(([value]) => value);
  const missing = checks
    .filter(([value]) => !text.includes(value))
    .map(([, label]) => label);
  if (missing.length)
    throw new Error(`META_ADS_DRAFT_INCOMPLETE: the draft's review does not show its ${missing.join(', ')}`);
  if (!(await pageShows(s.page, 'Does the page show this campaign as an unpublished draft?')))
    throw new Error(`META_ADS_DRAFT_STATE_ABSENT: the review does not show the campaign as an unpublished draft (${s.page.url()})`);
  if (!(await pageShows(s.page, 'Does the page say that all changes to the draft are saved?')))
    throw new Error(`META_ADS_DRAFT_UNSAVED: the draft is configured but the page does not say its changes are saved (${s.page.url()})`);
  return true;
}

export { fillCampaignFields, verifyConfiguredDraft };
