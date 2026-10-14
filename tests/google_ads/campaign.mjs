import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { getSocialAccount } from '../../dist/utils/credentials.js';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('google-ads-campaign');
const { report, request } = evidence;
const { values } = parseArgs({
  options: {
    'account-id': { type: 'string' },
    'customer-id': { type: 'string' },
    'name-prefix': { type: 'string' },
    objective: { type: 'string' },
    'app-subtype': { type: 'string' },
    type: { type: 'string' },
    proxy: { type: 'string' },
  },
});
const accountId = values['account-id'];
const campaignName = `${values['name-prefix']}-${randomUUID()}`;
const choices = {
  customer_id: values['customer-id'],
  campaign_name: campaignName,
  campaign_objective: values.objective,
  campaign_type: values.type,
  proxy_url_override: values.proxy,
  ...(values['app-subtype']?.trim()
    ? { app_campaign_subtype: values['app-subtype'] }
    : {}),
  submit: false,
};
let connected = false;
let failure;

async function run(params) {
  const admission = await request('/run', {
    action: 'google_ads_campaign',
    account_id: accountId,
    params,
    detached: true,
  });
  const id = admission.value.detached_run;
  assert.ok(id, JSON.stringify(admission.value));
  evidence.runs.add(id);
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

try {
  assert.equal(
    hostname(),
    process.env.WELES_TEST_DEDICATED_HOST,
    'run on the Stado-selected dedicated Weles host',
  );
  assert.ok(values['name-prefix']?.trim(), '--name-prefix is required');
  if (/app/i.test(values.type))
    assert.ok(
      values['app-subtype']?.trim(),
      '--app-subtype is required for App',
    );
  for (const [name, value] of Object.entries({ accountId, ...choices })) {
    if (name === 'submit') continue;
    assert.ok(typeof value === 'string' && value.trim(), `${name} is required`);
  }
  process.env.ACCOUNT_ID = accountId;
  const account = await getSocialAccount('google');
  assert.equal(
    account?.id,
    accountId,
    'the requested Google account must exist',
  );
  assert.equal(
    account.metadata.weles_real_test_fixture,
    true,
    'the account must be an isolated real-test fixture',
  );
  report.fixture = { account_id: accountId, customer_id: choices.customer_id };
  report.requested = choices;
  await evidence.connect();
  connected = true;
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);

  for (const key of ['campaign_name', 'campaign_objective', 'campaign_type']) {
    const refused = await run({ ...choices, [key]: '' });
    assert.equal(refused.ok, false, JSON.stringify(refused));
    assert.match(
      [refused.error, refused.stderr_tail, refused.stdout_tail].join('\n'),
      new RegExp(`none of ${key.toUpperCase()} is set`),
    );
  }
  const appSubtype = await run({
    ...choices,
    campaign_type: 'App',
    app_campaign_subtype: '',
  });
  assert.equal(appSubtype.ok, false, JSON.stringify(appSubtype));
  assert.match(
    [appSubtype.error, appSubtype.stderr_tail, appSubtype.stdout_tail].join(
      '\n',
    ),
    /none of APP_CAMPAIGN_SUBTYPE is set/,
  );
  report.app_subtype_refusal = appSubtype;

  const staged = await run(choices);
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.ok(
    staged.stdout_tail?.includes(
      `reached Google Ads campaign form for "${campaignName}" without publishing`,
    ),
    JSON.stringify(staged),
  );
  report.provider_form = staged;
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
  await evidence.finish();
}
if (failure) throw failure;
