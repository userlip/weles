// Meta Marketing API: lead generation form wrapper.
//
// ACTION_KIND (or META_ACTION) is required: create, read, list or update.
// Only the fields the caller states are sent; an update never rewrites a
// field, such as the locale, that the caller did not name, and a read returns
// the fields named in FIELDS or, without it, the ones Meta returns by default.

import {
  compactObject,
  graphRequest,
  parseJsonEnv,
  submitEnabled,
  withValidateOnly,
} from '../marketing_api.mjs';
import { statedChoice } from '../../../../_shared/inputs/stated.mjs';

const PAGE_ID =
  process.env.PAGE_ID ||
  process.env.FACEBOOK_PAGE_ID ||
  process.env.META_FACEBOOK_PAGE_ID;
const FORM_ID = process.env.LEAD_FORM_ID || process.env.FORM_ID;

function payload() {
  return compactObject({
    name: process.env.LEAD_FORM_NAME || process.env.NAME,
    locale: process.env.LOCALE,
    privacy_policy: parseJsonEnv(
      'PRIVACY_POLICY_JSON',
      process.env.PRIVACY_POLICY_URL
        ? { url: process.env.PRIVACY_POLICY_URL }
        : undefined,
    ),
    questions: parseJsonEnv('QUESTIONS_JSON'),
    follow_up_action_url: process.env.FOLLOW_UP_ACTION_URL,
    context_card: parseJsonEnv('CONTEXT_CARD_JSON'),
    thank_you_page: parseJsonEnv('THANK_YOU_PAGE_JSON'),
    block_display_for_non_targeted_viewer:
      process.env.BLOCK_NON_TARGETED_VIEWER,
  });
}

async function create() {
  if (!PAGE_ID) throw new Error('PAGE_ID or META_FACEBOOK_PAGE_ID required');
  await graphRequest(
    'POST',
    `/${PAGE_ID}/leadgen_forms`,
    withValidateOnly(payload(), { validateOnly: false }),
    { label: 'meta-ads-api-lead-form' },
  );
}

async function read() {
  const path = FORM_ID ? `/${FORM_ID}` : `/${PAGE_ID}/leadgen_forms`;
  await graphRequest(
    'GET',
    path,
    { fields: process.env.FIELDS, limit: process.env.LIMIT },
    {
      execute: submitEnabled() || process.env.LIVE_READ === '1',
      label: 'meta-ads-api-lead-form-read',
    },
  );
}

async function update() {
  if (!FORM_ID) throw new Error('LEAD_FORM_ID or FORM_ID required for update');
  await graphRequest(
    'POST',
    `/${FORM_ID}`,
    withValidateOnly(payload(), { validateOnly: false }),
    { label: 'meta-ads-api-lead-form-update' },
  );
}

// What each ACTION does; `list` is a read without a form id.
const ACTIONS = { create, read, list: read, update };

const action = statedChoice(['ACTION_KIND', 'META_ACTION'], ACTIONS, 'what is done with the lead form');
await ACTIONS[action]();
console.log(`PASS: Meta lead form API ${action} completed`);
