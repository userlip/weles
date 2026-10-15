// Meta Marketing API: custom audience and lookalike audience wrapper.
//
// ACTION_KIND (or META_ACTION) is required: create, update, read, list or
// delete. Only stated fields are sent. A create states the audience subtype
// and, for a customer-file audience, CUSTOMER_FILE_SOURCE, which declares to
// Meta where the customer data came from and so is the advertiser's to make.
// An update never resends a field the caller did not name.

import {
  adAccountId,
  compactObject,
  graphRequest,
  parseJsonEnv,
  submitEnabled,
  withValidateOnly,
} from './marketing_api.mjs';
import { statedChoice, statedText } from '../../../_shared/inputs/stated.mjs';

const AUDIENCE_ID = process.env.AUDIENCE_ID || process.env.CUSTOM_AUDIENCE_ID;

function fields() {
  return {
    name: process.env.AUDIENCE_NAME || process.env.NAME,
    description: process.env.DESCRIPTION,
    customer_file_source: process.env.CUSTOMER_FILE_SOURCE,
    rule: parseJsonEnv('AUDIENCE_RULE_JSON'),
    retention_days: process.env.RETENTION_DAYS
      ? Number(process.env.RETENTION_DAYS)
      : undefined,
    lookalike_spec: parseJsonEnv(
      'LOOKALIKE_SPEC_JSON',
      process.env.LOOKALIKE_SOURCE_ID
        ? compactObject({
            type: process.env.LOOKALIKE_TYPE,
            ratio: process.env.LOOKALIKE_RATIO
              ? Number(process.env.LOOKALIKE_RATIO)
              : undefined,
            country: process.env.LOOKALIKE_COUNTRY || process.env.COUNTRY,
            origin: [{ id: process.env.LOOKALIKE_SOURCE_ID }],
          })
        : undefined,
    ),
  };
}

async function create() {
  const subtype = statedText(
    ['AUDIENCE_SUBTYPE'],
    'the Meta audience subtype, e.g. CUSTOM or LOOKALIKE',
  ).toUpperCase();
  const body = compactObject({ ...fields(), subtype });
  if (subtype === 'CUSTOM' && !body.customer_file_source)
    throw new Error(
      'CUSTOMER_FILE_SOURCE is not set: a customer-file audience declares to Meta where its data came from; nothing was created',
    );
  await graphRequest(
    'POST',
    `/${adAccountId()}/customaudiences`,
    withValidateOnly(body, { validateOnly: false }),
    { label: 'meta-ads-api-audience' },
  );
}

async function update() {
  if (!AUDIENCE_ID)
    throw new Error('AUDIENCE_ID or CUSTOM_AUDIENCE_ID required for update');
  await graphRequest(
    'POST',
    `/${AUDIENCE_ID}`,
    withValidateOnly(compactObject(fields()), { validateOnly: false }),
    { label: 'meta-ads-api-audience-update' },
  );
}

async function read() {
  const path = AUDIENCE_ID
    ? `/${AUDIENCE_ID}`
    : `/${adAccountId()}/customaudiences`;
  await graphRequest(
    'GET',
    path,
    { fields: process.env.FIELDS, limit: process.env.LIMIT },
    {
      execute: submitEnabled() || process.env.LIVE_READ === '1',
      label: 'meta-ads-api-audience-read',
    },
  );
}

async function remove() {
  if (!AUDIENCE_ID)
    throw new Error('AUDIENCE_ID or CUSTOM_AUDIENCE_ID required for delete');
  await graphRequest(
    'DELETE',
    `/${AUDIENCE_ID}`,
    {},
    { label: 'meta-ads-api-audience-delete' },
  );
}

// What each ACTION does; `list` is a read without an audience id.
const ACTIONS = { create, update, read, list: read, delete: remove };

const action = statedChoice(['ACTION_KIND', 'META_ACTION'], ACTIONS, 'what is done with the audience');
await ACTIONS[action]();
console.log(`PASS: Meta audience API ${action} completed`);
