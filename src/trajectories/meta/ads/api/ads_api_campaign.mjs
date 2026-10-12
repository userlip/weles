// Meta Marketing API: dedicated campaign/ad set/ad stack wrapper.
//
// SUBMIT=1 mutates through wisent-integrations' Meta actions.
// Set RESOURCE=campaign|adset|ad|stack and ACTION=create|update|read|delete.

import {
  adAccountId,
  boolEnv,
  compactObject,
  graphRequest,
  microsFromUsd,
  parseJsonEnv,
  splitList,
  submitEnabled,
  withValidateOnly,
} from './marketing_api.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';

const RESOURCE = (
  process.env.RESOURCE ||
  process.env.META_RESOURCE ||
  'stack'
).toLowerCase();
const ACTION = (
  process.env.ACTION_KIND ||
  process.env.META_ACTION ||
  'create'
).toLowerCase();
const SUBMIT = submitEnabled();

const CAMPAIGN_ID = process.env.CAMPAIGN_ID;
const AD_SET_ID = process.env.AD_SET_ID || process.env.ADSET_ID;
const AD_ID = process.env.AD_ID;
const CREATIVE_ID = process.env.CREATIVE_ID;

// Names and the objective are the advertiser's choices. Each is read when the
// object it names is created, refusing a missing one by name; reads, updates
// and deletes never need them.
const campaignName = () =>
  statedText(
    ['CAMPAIGN_NAME'],
    'the name the ad account lists the campaign under',
  );
const status = (process.env.STATUS || 'PAUSED').toUpperCase();
const specialAdCategories = parseJsonEnv(
  'SPECIAL_AD_CATEGORIES',
  splitList(process.env.SPECIAL_AD_CATEGORIES || 'NONE'),
);

const campaignCreate = () =>
  compactObject({
    name: campaignName(),
    objective: statedText(
      ['CAMPAIGN_OBJECTIVE'],
      'the Meta campaign objective, e.g. OUTCOME_TRAFFIC',
    ),
    status,
    special_ad_categories: specialAdCategories,
    buying_type: process.env.BUYING_TYPE,
    bid_strategy:
      process.env.CAMPAIGN_BID_STRATEGY ||
      (RESOURCE === 'campaign' ||
      process.env.CAMPAIGN_DAILY_BUDGET_USD ||
      process.env.CAMPAIGN_LIFETIME_BUDGET_USD
        ? process.env.BID_STRATEGY
        : undefined),
    daily_budget: microsFromUsd(
      process.env.CAMPAIGN_DAILY_BUDGET_USD ||
        (RESOURCE === 'campaign' ? process.env.DAILY_BUDGET_USD : undefined),
    ),
    lifetime_budget: microsFromUsd(
      process.env.CAMPAIGN_LIFETIME_BUDGET_USD ||
        (RESOURCE === 'campaign' ? process.env.LIFETIME_BUDGET_USD : undefined),
    ),
    is_adset_budget_sharing_enabled:
      process.env.IS_ADSET_BUDGET_SHARING_ENABLED ||
      (!process.env.CAMPAIGN_DAILY_BUDGET_USD &&
      !process.env.CAMPAIGN_LIFETIME_BUDGET_USD
        ? false
        : undefined),
  });

const targeting = () =>
  parseJsonEnv(
    'TARGETING_JSON',
    compactObject({
      geo_locations: parseJsonEnv(
        'GEO_LOCATIONS_JSON',
        process.env.COUNTRIES
          ? { countries: splitList(process.env.COUNTRIES) }
          : undefined,
      ),
      age_min: process.env.AGE_MIN ? Number(process.env.AGE_MIN) : undefined,
      age_max: process.env.AGE_MAX ? Number(process.env.AGE_MAX) : undefined,
      genders: parseJsonEnv(
        'GENDERS_JSON',
        process.env.GENDERS
          ? splitList(process.env.GENDERS).map(Number)
          : undefined,
      ),
      custom_audiences: parseJsonEnv(
        'CUSTOM_AUDIENCES_JSON',
        process.env.CUSTOM_AUDIENCE_ID
          ? [{ id: process.env.CUSTOM_AUDIENCE_ID }]
          : undefined,
      ),
      excluded_custom_audiences: parseJsonEnv('EXCLUDED_CUSTOM_AUDIENCES_JSON'),
      publisher_platforms: process.env.PUBLISHER_PLATFORMS
        ? splitList(process.env.PUBLISHER_PLATFORMS)
        : undefined,
      facebook_positions: process.env.FACEBOOK_POSITIONS
        ? splitList(process.env.FACEBOOK_POSITIONS)
        : undefined,
      instagram_positions: process.env.INSTAGRAM_POSITIONS
        ? splitList(process.env.INSTAGRAM_POSITIONS)
        : undefined,
      audience_network_positions: process.env.AUDIENCE_NETWORK_POSITIONS
        ? splitList(process.env.AUDIENCE_NETWORK_POSITIONS)
        : undefined,
      messenger_positions: process.env.MESSENGER_POSITIONS
        ? splitList(process.env.MESSENGER_POSITIONS)
        : undefined,
    }),
  );

const promotedObject = () =>
  parseJsonEnv(
    'PROMOTED_OBJECT_JSON',
    compactObject({
      application_id: process.env.APP_ID,
      object_store_url: process.env.OBJECT_STORE_URL,
      page_id:
        process.env.PROMOTED_PAGE_ID ||
        (boolEnv('PROMOTED_OBJECT_USES_PAGE', false)
          ? process.env.PAGE_ID ||
            process.env.FACEBOOK_PAGE_ID ||
            process.env.META_FACEBOOK_PAGE_ID
          : undefined),
      pixel_id: process.env.PIXEL_ID,
      custom_event_type: process.env.APP_EVENT || process.env.CUSTOM_EVENT_TYPE,
      product_catalog_id: process.env.CATALOG_ID,
      product_set_id: process.env.PRODUCT_SET_ID,
      whatsapp_phone_number: process.env.WHATSAPP_NUMBER,
    }),
  );

const adSetCreate = (campaignId = CAMPAIGN_ID) =>
  compactObject({
    name: statedText(
      ['AD_SET_NAME'],
      'the name the ad account lists the ad set under',
    ),
    campaign_id: campaignId,
    status: process.env.AD_SET_STATUS || 'PAUSED',
    daily_budget: microsFromUsd(
      process.env.AD_SET_DAILY_BUDGET_USD || process.env.DAILY_BUDGET_USD,
    ),
    lifetime_budget: microsFromUsd(
      process.env.AD_SET_LIFETIME_BUDGET_USD || process.env.LIFETIME_BUDGET_USD,
    ),
    bid_amount: microsFromUsd(process.env.BID_AMOUNT_USD),
    bid_strategy: process.env.BID_STRATEGY || 'LOWEST_COST_WITHOUT_CAP',
    billing_event: process.env.BILLING_EVENT || 'IMPRESSIONS',
    optimization_goal: process.env.OPTIMIZATION_GOAL || 'LINK_CLICKS',
    destination_type:
      process.env.CAMPAIGN_DESTINATION || process.env.DESTINATION_TYPE,
    targeting: targeting(),
    promoted_object: promotedObject(),
    start_time: process.env.START_TIME,
    end_time: process.env.END_TIME,
  });

const objectStorySpec = () =>
  parseJsonEnv(
    'OBJECT_STORY_SPEC_JSON',
    compactObject({
      page_id:
        process.env.PAGE_ID ||
        process.env.FACEBOOK_PAGE_ID ||
        process.env.META_FACEBOOK_PAGE_ID,
      instagram_actor_id: process.env.INSTAGRAM_ACTOR_ID,
      link_data: parseJsonEnv(
        'LINK_DATA_JSON',
        process.env.DESTINATION_URL || process.env.FINAL_URL
          ? compactObject({
              link: process.env.DESTINATION_URL || process.env.FINAL_URL,
              message: process.env.PRIMARY_TEXT,
              name: process.env.HEADLINE,
              description: process.env.DESCRIPTION,
              call_to_action: process.env.CALL_TO_ACTION_TYPE
                ? {
                    type: process.env.CALL_TO_ACTION_TYPE,
                    value: compactObject({
                      link:
                        process.env.DESTINATION_URL || process.env.FINAL_URL,
                      app_link: process.env.APP_LINK,
                      page: process.env.CALL_TO_ACTION_PAGE_ID,
                      whatsapp_number: process.env.WHATSAPP_NUMBER,
                    }),
                  }
                : undefined,
              image_hash: process.env.IMAGE_HASH,
              child_attachments: parseJsonEnv('CHILD_ATTACHMENTS_JSON'),
            })
          : undefined,
      ),
      template_data: parseJsonEnv('TEMPLATE_DATA_JSON'),
      video_data: parseJsonEnv('VIDEO_DATA_JSON'),
    }),
  );

const creativeCreate = () =>
  compactObject({
    name: statedText(
      ['CREATIVE_NAME', 'AD_NAME'],
      'the name the ad account lists the creative under',
    ),
    object_story_spec: objectStorySpec(),
    asset_feed_spec: parseJsonEnv('ASSET_FEED_SPEC_JSON'),
    product_set_id: process.env.PRODUCT_SET_ID,
    url_tags: process.env.URL_PARAMS,
  });

const adCreate = (adSetId = AD_SET_ID, creativeId = CREATIVE_ID) =>
  compactObject({
    name: statedText(['AD_NAME'], 'the name the ad account lists the ad under'),
    adset_id: adSetId,
    creative: creativeId
      ? { creative_id: creativeId }
      : parseJsonEnv('CREATIVE_JSON'),
    status: process.env.AD_STATUS || 'PAUSED',
    tracking_specs: parseJsonEnv('TRACKING_SPECS_JSON'),
  });

// Each Marketing API object this trajectory handles: the account edge it is
// created and listed under, the id an update, read or delete addresses, and
// the body a create sends.
const RESOURCES = {
  campaign: {
    edge: 'campaigns',
    id: CAMPAIGN_ID,
    body: () => campaignCreate(),
  },
  adset: { edge: 'adsets', id: AD_SET_ID, body: () => adSetCreate() },
  creative: {
    edge: 'adcreatives',
    id: CREATIVE_ID,
    body: () => creativeCreate(),
  },
  ad: { edge: 'ads', id: AD_ID, body: () => adCreate() },
};

function resourceSpec(resource) {
  if (!Object.hasOwn(RESOURCES, resource))
    throw new Error(
      `unsupported RESOURCE=${resource}; one of ${Object.keys(RESOURCES).join(', ')} or stack`,
    );
  return RESOURCES[resource];
}

async function createResource(resource) {
  const spec = resourceSpec(resource);
  return graphRequest(
    'POST',
    `/${adAccountId()}/${spec.edge}`,
    withValidateOnly(spec.body()),
    { label: `meta-ads-api-${resource}` },
  );
}

async function updateResource(resource) {
  const { id } = resourceSpec(resource);
  const fields = parseJsonEnv(
    'UPDATE_JSON',
    compactObject({
      name:
        process.env.CAMPAIGN_NAME ||
        process.env.AD_SET_NAME ||
        process.env.AD_NAME,
      status:
        process.env.STATUS ||
        process.env.AD_SET_STATUS ||
        process.env.AD_STATUS,
      bid_strategy: process.env.BID_STRATEGY,
      daily_budget: microsFromUsd(process.env.DAILY_BUDGET_USD),
      lifetime_budget: microsFromUsd(process.env.LIFETIME_BUDGET_USD),
      targeting: process.env.TARGETING_JSON ? targeting() : undefined,
    }),
  );
  if (!id) throw new Error(`${resource.toUpperCase()} id required for update`);
  return graphRequest('POST', `/${id}`, withValidateOnly(fields), {
    label: `meta-ads-api-${resource}-update`,
  });
}

async function readResource(resource) {
  const { id, edge } = resourceSpec(resource);
  const fields =
    process.env.FIELDS ||
    'id,name,status,effective_status,created_time,updated_time';
  const readOpts = {
    execute: SUBMIT || boolEnv('LIVE_READ', false),
    label: `meta-ads-api-${resource}-read`,
  };
  if (id) return graphRequest('GET', `/${id}`, { fields }, readOpts);
  return graphRequest(
    'GET',
    `/${adAccountId()}/${edge}`,
    { fields, limit: process.env.LIMIT },
    { ...readOpts, label: `meta-ads-api-${resource}-list` },
  );
}

async function deleteResource(resource) {
  const { id } = resourceSpec(resource);
  if (!id) throw new Error(`${resource.toUpperCase()} id required for delete`);
  return graphRequest(
    'DELETE',
    `/${id}`,
    {},
    { label: `meta-ads-api-${resource}-delete` },
  );
}

// What each ACTION does to a single RESOURCE; `list` is a read without an id.
const ACTIONS = {
  create: createResource,
  update: updateResource,
  read: readResource,
  list: readResource,
  delete: deleteResource,
};

async function createStack() {
  if (!SUBMIT)
    throw new Error('SUBMIT=1 required for Meta Ads API stack create');
  const campaign = await graphRequest(
    'POST',
    `/${adAccountId()}/campaigns`,
    campaignCreate(),
    { label: 'meta-ads-api-campaign', submit: true },
  );
  const campaignId = campaign.id;
  const adset = await graphRequest(
    'POST',
    `/${adAccountId()}/adsets`,
    adSetCreate(campaignId),
    { label: 'meta-ads-api-adset', submit: true },
  );
  const creative = await graphRequest(
    'POST',
    `/${adAccountId()}/adcreatives`,
    creativeCreate(),
    { label: 'meta-ads-api-creative', submit: true },
  );
  const ad = await graphRequest(
    'POST',
    `/${adAccountId()}/ads`,
    adCreate(adset.id, creative.id),
    { label: 'meta-ads-api-ad', submit: true },
  );
  console.log(
    `PASS: Meta Ads API stack created campaign=${campaignId} adset=${adset.id} creative=${creative.id} ad=${ad.id}`,
  );
}

try {
  if (RESOURCE === 'stack') {
    if (ACTION !== 'create')
      throw new Error('RESOURCE=stack supports ACTION=create only');
    await createStack();
  } else if (Object.hasOwn(ACTIONS, ACTION)) await ACTIONS[ACTION](RESOURCE);
  else
    throw new Error(
      `unsupported ACTION=${ACTION}; one of ${Object.keys(ACTIONS).join(', ')}`,
    );
  if (RESOURCE !== 'stack')
    console.log(`PASS: Meta Ads API ${ACTION} ${RESOURCE} completed`);
} catch (e) {
  console.log('FAIL:', e.message);
  process.exit(1);
}
