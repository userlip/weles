import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('meta-marketing-api');
const { report, request } = evidence;
report.scope = 'real_meta_marketing_api';
let connected = false;
let campaignId;
let failure;

async function run(action, params) {
  const admitted = await request('/run', {
    action,
    params,
    detached: true,
  });
  const id = admitted.value.detached_run;
  assert.ok(id, JSON.stringify(admitted.value));
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

function graphResult(result) {
  assert.equal(result.status, 'finished', JSON.stringify(result));
  assert.equal(result.ok, true, JSON.stringify(result));
  return JSON.parse(result.stdout_tail.split('\nPASS:').shift().trim());
}

try {
  const { values } = parseArgs({
    options: {
      'ad-account': { type: 'string' },
      'business-id': { type: 'string' },
      objective: { type: 'string' },
      'special-ad-categories': { type: 'string' },
      'name-prefix': { type: 'string' },
      status: { type: 'string' },
      'lead-form-id': { type: 'string' },
      'lead-form-name': { type: 'string' },
      'lead-form-locale': { type: 'string' },
    },
  });
  for (const key of [
    'ad-account',
    'business-id',
    'objective',
    'special-ad-categories',
    'name-prefix',
    'lead-form-id',
    'lead-form-name',
    'lead-form-locale',
    'status',
  ]) {
    assert.ok(
      values[key]?.trim(),
      `--${key} is required for the isolated Meta fixture`,
    );
  }
  assert.notEqual(
    values['lead-form-locale'],
    'en_US',
    'the dedicated lead form must expose an observable locale change',
  );
  assert.equal(
    values.status,
    'PAUSED',
    'the isolated fixture must never start spending',
  );
  const categories = JSON.parse(values['special-ad-categories']);
  assert.ok(
    Array.isArray(categories),
    'special ad categories must be a JSON array',
  );
  report.fixture = {
    ad_account: values['ad-account'],
    business: values['business-id'],
    lead_form: {
      id: values['lead-form-id'],
      name: values['lead-form-name'],
      locale: values['lead-form-locale'],
    },
    objective: values.objective,
    special_ad_categories: categories,
    status: values.status,
  };

  await evidence.connect();
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);
  connected = true;

  for (const [action, params, missing] of [
    [
      'meta_ads_api_campaign',
      { resource: 'campaign' },
      'ACTION_KIND, META_ACTION',
    ],
    ['meta_ads_api_catalog', { action: 'create' }, 'RESOURCE'],
    ['meta_ads_api_audience', {}, 'ACTION_KIND, META_ACTION'],
    ['meta_ads_api_creative', { action: 'create' }, 'RESOURCE'],
    ['meta_ads_api_lead_form', {}, 'ACTION_KIND, META_ACTION'],
    ['meta_ads_api_lead_form', { action: 'unknown' }, 'not one of'],
  ]) {
    const refused = await run(action, params);
    assert.equal(refused.status, 'failed');
    assert.equal(refused.ok, false);
    assert.match(
      [refused.error, refused.stderr_tail, refused.stdout_tail].join('\n'),
      new RegExp(missing),
    );
  }

  for (const [action, params] of [
    ['meta_ads_api_audience', { ad_account_id: values['ad-account'] }],
    [
      'meta_ads_api_creative',
      {
        ad_account_id: values['ad-account'],
        resource: 'creative',
      },
    ],
    [
      'meta_ads_api_catalog',
      {
        business_id: values['business-id'],
        resource: 'catalog',
      },
    ],
  ]) {
    const listed = graphResult(
      await run(action, {
        ...params,
        action: 'list',
        fields: 'id,name',
        live_read: true,
      }),
    );
    assert.ok(Array.isArray(listed.data), JSON.stringify(listed));
  }

  const leadForm = {
    form_id: values['lead-form-id'],
    fields: 'id,name,locale',
    live_read: true,
  };
  const formBefore = graphResult(
    await run('meta_ads_api_lead_form', {
      ...leadForm,
      action: 'read',
    }),
  );
  assert.equal(formBefore.id, values['lead-form-id']);
  assert.equal(formBefore.name, values['lead-form-name']);
  assert.equal(formBefore.locale, values['lead-form-locale']);
  graphResult(
    await run('meta_ads_api_lead_form', {
      ...leadForm,
      action: 'update',
      lead_form_name: values['lead-form-name'],
      submit: true,
    }),
  );
  const formAfter = graphResult(
    await run('meta_ads_api_lead_form', {
      ...leadForm,
      action: 'read',
    }),
  );
  assert.equal(formAfter.locale, formBefore.locale);
  assert.equal(formAfter.name, formBefore.name);

  const name = `${values['name-prefix']}-${randomUUID()}`;
  const created = graphResult(
    await run('meta_ads_api_campaign', {
      resource: 'campaign',
      action: 'create',
      ad_account_id: values['ad-account'],
      campaign_name: name,
      campaign_objective: values.objective,
      special_ad_categories: categories,
      status: values.status,
      submit: true,
    }),
  );
  assert.ok(created.id, JSON.stringify(created));
  campaignId = created.id;

  const address = {
    resource: 'campaign',
    campaign_id: campaignId,
    fields: 'id,name,status',
    live_read: true,
  };
  const initial = graphResult(
    await run('meta_ads_api_campaign', {
      ...address,
      action: 'read',
    }),
  );
  assert.equal(initial.id, campaignId);
  assert.equal(initial.name, name);
  assert.equal(initial.status, values.status);

  graphResult(
    await run('meta_ads_api_campaign', {
      ...address,
      action: 'update',
      ad_set_name: `${name}-unrelated`,
      status: values.status,
      submit: true,
    }),
  );
  const unchanged = graphResult(
    await run('meta_ads_api_campaign', {
      ...address,
      action: 'read',
    }),
  );
  assert.equal(
    unchanged.name,
    name,
    'an ad set name must not rename a campaign',
  );

  const renamed = `${name}-updated`;
  graphResult(
    await run('meta_ads_api_campaign', {
      ...address,
      action: 'update',
      campaign_name: renamed,
      submit: true,
    }),
  );
  const observed = graphResult(
    await run('meta_ads_api_campaign', {
      ...address,
      action: 'read',
    }),
  );
  assert.equal(observed.name, renamed);
  report.observed_campaign = {
    id: campaignId,
    name: observed.name,
    status: observed.status,
  };
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = connected ? 'failed' : 'blocked';
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
} finally {
  if (campaignId) {
    try {
      const deleted = graphResult(
        await run('meta_ads_api_campaign', {
          resource: 'campaign',
          action: 'delete',
          campaign_id: campaignId,
          submit: true,
        }),
      );
      assert.equal(deleted.success, true, JSON.stringify(deleted));
      report.deleted_campaign = { id: campaignId, result: deleted };
    } catch (error) {
      report.status = 'failed';
      report.cleanup_error = { name: error.name, message: error.message };
      failure = error;
    }
  }
  await evidence.finish();
}
if (failure) throw failure;
