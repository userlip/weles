// Meta Marketing API: Messenger/WhatsApp destination ad stack create wrapper.
//
// Every choice this stack spends money under is the advertiser's: the
// destination, the names, the objective, how it bills and optimises, who it
// targets and which special ad categories it declares. Each is read by name
// and a missing one refuses the run before anything is created.

import {
  compactObject,
  graphRequest,
  parseJsonEnv,
  submitEnabled,
  withValidateOnly,
  adAccountId,
  microsFromUsd,
} from '../marketing_api.mjs';
import { statedText } from '../../../../_shared/inputs/stated.mjs';

// What each messaging destination sets on the ad: the call to action and,
// for Messenger, the app the conversation opens in.
const DESTINATIONS = {
  messenger: { ctaType: 'MESSAGE_PAGE', appDestination: 'MESSENGER' },
  whatsapp: { ctaType: 'WHATSAPP_MESSAGE', appDestination: undefined },
};

/** A stated JSON value: refused by name when unset, parsed when set. */
function statedJson(name, what) {
  statedText([name], what);
  return parseJsonEnv(name);
}

function promotedObject() {
  return compactObject({
    page_id:
      process.env.PAGE_ID ||
      process.env.FACEBOOK_PAGE_ID ||
      process.env.META_FACEBOOK_PAGE_ID,
    whatsapp_phone_number: process.env.WHATSAPP_NUMBER,
    application_id: process.env.APP_ID,
  });
}

function creativePayload(destination) {
  // The ad's destination is the advertiser's; a built-in one would publish
  // a paid ad pointing somewhere nobody chose.
  const link = process.env.DESTINATION_URL || process.env.FINAL_URL;
  if (!link)
    throw new Error(
      'DESTINATION_URL (or FINAL_URL) is required: the page the ad sends people to; none is assumed',
    );
  return compactObject({
    name: statedText(
      ['CREATIVE_NAME'],
      'the name the ad account lists the creative under',
    ),
    object_story_spec: parseJsonEnv('OBJECT_STORY_SPEC_JSON', {
      page_id:
        process.env.PAGE_ID ||
        process.env.FACEBOOK_PAGE_ID ||
        process.env.META_FACEBOOK_PAGE_ID,
      link_data: compactObject({
        link,
        message: process.env.PRIMARY_TEXT,
        name: process.env.HEADLINE,
        call_to_action: {
          type: process.env.CALL_TO_ACTION_TYPE || destination.ctaType,
          value: compactObject({
            app_destination: destination.appDestination,
            whatsapp_number: process.env.WHATSAPP_NUMBER,
          }),
        },
        image_hash: process.env.IMAGE_HASH,
      }),
    }),
  });
}

// Every failure is thrown with its cause; nothing below is caught.
{
  const destinationName = statedText(
    ['CAMPAIGN_DESTINATION', 'DESTINATION_TYPE'],
    `where the ad opens a conversation, one of ${Object.keys(DESTINATIONS).join(', ')}`,
  ).toLowerCase();
  if (!Object.hasOwn(DESTINATIONS, destinationName))
    throw new Error(
      `CAMPAIGN_DESTINATION is "${destinationName}", not one of ${Object.keys(DESTINATIONS).join(', ')}; nothing was created`,
    );
  const destination = DESTINATIONS[destinationName];
  if (!submitEnabled())
    throw new Error('SUBMIT=1 required to create Meta messaging stack');
  // Every stated input is read before the first object is created, so a
  // missing one never leaves a campaign behind without its ad set or ad.
  const campaignBody = {
    name: statedText(
      ['CAMPAIGN_NAME'],
      'the name the ad account lists the campaign under',
    ),
    objective: statedText(
      ['CAMPAIGN_OBJECTIVE'],
      'the Meta campaign objective, e.g. OUTCOME_ENGAGEMENT',
    ),
    status: 'PAUSED',
    special_ad_categories: statedJson(
      'SPECIAL_AD_CATEGORIES',
      'the special ad categories the advertiser declares to Meta, as a JSON array',
    ),
  };
  const adsetBody = {
    name: statedText(
      ['AD_SET_NAME'],
      'the name the ad account lists the ad set under',
    ),
    billing_event: statedText(
      ['BILLING_EVENT'],
      'what Meta charges the ad set for, e.g. IMPRESSIONS',
    ),
    optimization_goal: statedText(
      ['OPTIMIZATION_GOAL'],
      'what Meta optimises the ad set for, e.g. CONVERSATIONS',
    ),
    destination_type: destinationName.toUpperCase(),
    daily_budget: microsFromUsd(process.env.DAILY_BUDGET_USD),
    targeting: statedJson(
      'TARGETING_JSON',
      'who the ad set reaches, as Meta targeting JSON',
    ),
    promoted_object: promotedObject(),
    status: 'PAUSED',
  };
  const creativeBody = creativePayload(destination);
  const adName = statedText(
    ['AD_NAME'],
    'the name the ad account lists the ad under',
  );
  const campaign = await graphRequest(
    'POST',
    `/${adAccountId()}/campaigns`,
    campaignBody,
    { submit: true, label: 'meta-ads-api-messaging-campaign' },
  );
  const adset = await graphRequest(
    'POST',
    `/${adAccountId()}/adsets`,
    withValidateOnly(
      { ...adsetBody, campaign_id: campaign.id },
      { submit: true },
    ),
    { submit: true, label: 'meta-ads-api-messaging-adset' },
  );
  const creative = await graphRequest(
    'POST',
    `/${adAccountId()}/adcreatives`,
    creativeBody,
    { submit: true, label: 'meta-ads-api-messaging-creative' },
  );
  const ad = await graphRequest(
    'POST',
    `/${adAccountId()}/ads`,
    {
      name: adName,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    },
    { submit: true, label: 'meta-ads-api-messaging-ad' },
  );
  console.log(
    `PASS: Meta messaging stack created campaign=${campaign.id} adset=${adset.id} creative=${creative.id} ad=${ad.id}`,
  );
  console.log('PASS: Meta messaging API completed');
}
