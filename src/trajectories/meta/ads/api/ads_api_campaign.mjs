// Meta Marketing API: dedicated campaign/ad set/ad stack wrapper.
//
// SUBMIT=1 mutates through wisent-integrations' Meta actions.
// RESOURCE=campaign|adset|creative|ad|stack and ACTION=create|update|read|
// list|delete are both required; nothing is created by default.

import {
  adAccountId,
  boolEnv,
  compactObject,
  graphRequest,
  microsFromUsd,
  parseJsonEnv,
  submitEnabled,
  withValidateOnly,
} from './marketing_api.mjs';
import { statedChoice, statedText } from '../../../_shared/inputs/stated.mjs';
import {
  adSetCreate,
  campaignCreate,
  objectStorySpec,
  targeting,
} from './campaign/inputs.mjs';

const SUBMIT = submitEnabled();

const CAMPAIGN_ID = process.env.CAMPAIGN_ID;
const AD_SET_ID = process.env.AD_SET_ID || process.env.ADSET_ID;
const AD_ID = process.env.AD_ID;
const CREATIVE_ID = process.env.CREATIVE_ID;

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
    status: statedText(['AD_STATUS'], 'the initial ad status'),
    tracking_specs: parseJsonEnv('TRACKING_SPECS_JSON'),
  });

// Each Marketing API object this trajectory handles: the account edge it is
// created and listed under, the id an update, read or delete addresses, and
// the body a create sends.
const RESOURCES = {
  campaign: {
    edge: 'campaigns',
    id: CAMPAIGN_ID,
    body: () => campaignCreate(RESOURCE),
  },
  adset: { edge: 'adsets', id: AD_SET_ID, body: () => adSetCreate() },
  creative: {
    edge: 'adcreatives',
    id: CREATIVE_ID,
    body: () => creativeCreate(),
  },
  ad: { edge: 'ads', id: AD_ID, body: () => adCreate() },
  stack: { body: createStack },
};

const RESOURCE = statedChoice(
  ['RESOURCE', 'META_RESOURCE'],
  RESOURCES,
  'the object acted on',
);

function resourceSpec(resource) {
  if (!Object.hasOwn(RESOURCES, resource))
    throw new Error(
      `unsupported RESOURCE=${resource}; one of ${Object.keys(RESOURCES).join(', ')}`,
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

const UPDATE_FIELDS = {
  campaign: () =>
    compactObject({
      name: process.env.CAMPAIGN_NAME,
      status: process.env.STATUS,
      bid_strategy: process.env.BID_STRATEGY,
      daily_budget: microsFromUsd(process.env.DAILY_BUDGET_USD),
      lifetime_budget: microsFromUsd(process.env.LIFETIME_BUDGET_USD),
    }),
  adset: () =>
    compactObject({
      name: process.env.AD_SET_NAME,
      status: process.env.AD_SET_STATUS,
      bid_strategy: process.env.BID_STRATEGY,
      daily_budget: microsFromUsd(process.env.DAILY_BUDGET_USD),
      lifetime_budget: microsFromUsd(process.env.LIFETIME_BUDGET_USD),
      targeting: process.env.TARGETING_JSON ? targeting() : undefined,
    }),
  creative: () => compactObject({ name: process.env.CREATIVE_NAME }),
  ad: () =>
    compactObject({
      name: process.env.AD_NAME,
      status: process.env.AD_STATUS,
    }),
};

async function updateResource(resource) {
  const { id } = resourceSpec(resource);
  if (!id) throw new Error(`${resource.toUpperCase()} id required for update`);
  const fields = process.env.UPDATE_JSON
    ? parseJsonEnv('UPDATE_JSON')
    : UPDATE_FIELDS[resource]();
  return graphRequest('POST', `/${id}`, withValidateOnly(fields), {
    label: `meta-ads-api-${resource}-update`,
  });
}

async function readResource(resource) {
  const { id, edge } = resourceSpec(resource);
  const fields = process.env.FIELDS;
  const readOpts = {
    execute: SUBMIT || boolEnv('LIVE_READ'),
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

const ACTION = statedChoice(
  ['ACTION_KIND', 'META_ACTION'],
  ACTIONS,
  'what is done with the selected resource',
);

async function createStack() {
  if (!SUBMIT)
    throw new Error('SUBMIT=1 required for Meta Ads API stack create');
  // Every body is built, and so every stated input read, before the first
  // object is created: a missing one never leaves a campaign without its ad.
  const campaignBody = campaignCreate(RESOURCE);
  const adsetBody = adSetCreate();
  const creativeBody = creativeCreate();
  const adBody = adCreate();
  const campaign = await graphRequest(
    'POST',
    `/${adAccountId()}/campaigns`,
    campaignBody,
    { label: 'meta-ads-api-campaign', submit: true },
  );
  const campaignId = campaign.id;
  const adset = await graphRequest(
    'POST',
    `/${adAccountId()}/adsets`,
    { ...adsetBody, campaign_id: campaignId },
    { label: 'meta-ads-api-adset', submit: true },
  );
  const creative = await graphRequest(
    'POST',
    `/${adAccountId()}/adcreatives`,
    creativeBody,
    { label: 'meta-ads-api-creative', submit: true },
  );
  const ad = await graphRequest(
    'POST',
    `/${adAccountId()}/ads`,
    {
      ...adBody,
      adset_id: adset.id,
      creative: { creative_id: creative.id },
    },
    { label: 'meta-ads-api-ad', submit: true },
  );
  console.log(
    `PASS: Meta Ads API stack created campaign=${campaignId} adset=${adset.id} creative=${creative.id} ad=${ad.id}`,
  );
}

if (RESOURCE === 'stack') {
  if (ACTION !== 'create')
    throw new Error('RESOURCE=stack supports ACTION=create only');
  await createStack();
} else {
  await ACTIONS[ACTION](RESOURCE);
  console.log(`PASS: Meta Ads API ${ACTION} ${RESOURCE} completed`);
}
