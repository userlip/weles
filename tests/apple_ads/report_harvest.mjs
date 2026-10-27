import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { getSocialAccount } from '../../dist/utils/credentials.js';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('apple-ads-report-harvest');
const { report, request } = evidence;
const { values } = parseArgs({
  options: {
    'account-id': { type: 'string' },
    'app-id': { type: 'string' },
    'date-presets': { type: 'string' },
    'exact-ranges': { type: 'string' },
    'rejected-range': { type: 'string' },
  },
});
const accountId = values['account-id'];
const rejectedRange = values['rejected-range'];
const params = {
  apple_ads_app_id: values['app-id'],
  apple_ads_date_presets: values['date-presets'],
  apple_ads_exact_ranges: values['exact-ranges'],
};
let failure;
let connected = false;

async function run(runParams) {
  const admission = await request('/run', {
    action: 'apple_ads_report_harvest',
    account_id: accountId,
    params: runParams,
    detached: true,
  });
  if (!admission.value.detached_run) return admission.value;
  const id = admission.value.detached_run;
  evidence.runs.add(id);
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

function observedAmount(value) {
  const raw =
    value !== null && typeof value === 'object' ? value.amount : value;
  return raw === undefined || raw === null || raw === '' ? null : Number(raw);
}

try {
  assert.equal(
    hostname(),
    process.env.WELES_TEST_DEDICATED_HOST,
    'run on the Stado-selected dedicated Weles host',
  );
  for (const [name, value] of Object.entries({
    accountId,
    rejectedRange,
    ...params,
  })) {
    assert.ok(typeof value === 'string' && value.trim(), `${name} is required`);
  }
  process.env.ACCOUNT_ID = accountId;
  const account = await getSocialAccount('apple');
  assert.equal(
    account?.id,
    accountId,
    'the requested Apple account must exist',
  );
  assert.equal(
    account.metadata.weles_real_test_fixture,
    true,
    'the named account must be an isolated real-test fixture',
  );
  report.fixture = { account_id: accountId, app_id: params.apple_ads_app_id };
  await evidence.connect();
  connected = true;
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);

  const missing = await run({
    apple_ads_app_id: params.apple_ads_app_id,
    apple_ads_date_presets: params.apple_ads_date_presets,
  });
  assert.equal(missing.ok, false);
  assert.match(
    [missing.error, missing.stderr_tail, missing.stdout_tail].join('\n'),
    /apple_ads_exact_ranges is required/,
  );
  report.missing_range = missing;

  const malformed = await run({
    ...params,
    apple_ads_exact_ranges: 'not-a-range',
  });
  assert.equal(malformed.ok, false);
  assert.match(
    [malformed.error, malformed.stderr_tail, malformed.stdout_tail].join('\n'),
    /APPLE_ADS_EXACT_RANGES entry.*is not label=/,
  );
  report.malformed_range = malformed;
  const refused = await run({
    ...params,
    apple_ads_exact_ranges: rejectedRange,
  });
  assert.equal(refused.ok, false, JSON.stringify(refused));
  const refusal = [
    refused.error,
    refused.stderr_tail,
    refused.stdout_tail,
  ].join('\n');
  const rejectedLabel = rejectedRange.split('=').shift().trim();
  assert.ok(refusal.includes(`range ${rejectedLabel} (`), refusal);
  assert.match(refusal, /answered HTTP \d+; GraphQL errors:/);
  assert.equal(refused.outputs?.apple_ads_report_harvest?.ok, false);
  report.provider_refusal = refused;

  const completed = await run(params);
  assert.equal(completed.ok, true, JSON.stringify(completed));
  const harvest = completed.outputs?.apple_ads_report_harvest;
  assert.equal(harvest?.ok, true, 'the worker must expose the report artifact');
  const expectedLabels = params.apple_ads_exact_ranges
    .split(',')
    .map((range) => range.split('=').shift().trim());
  const summaries = harvest.summary.exactReports;
  const rawReports = harvest.exactReports;
  assert.deepEqual(
    summaries.map((range) => range.label),
    expectedLabels,
  );
  assert.deepEqual(
    rawReports.map((range) => range.label),
    expectedLabels,
  );
  for (const [index, summary] of summaries.entries()) {
    const raw = rawReports[index];
    assert.equal(raw.ok, true, JSON.stringify(raw));
    assert.equal(raw.status, summary.status);
    assert.ok(!raw.json.errors?.length, `GraphQL refused ${summary.label}`);
    const provider = raw.json.data.reportingV5.getReportsByCampaign;
    assert.equal(summary.campaigns.length, provider.row.length);
    const spend = provider.grandTotals?.total?.localSpend;
    const installs = provider.grandTotals?.total?.totalInstalls;
    assert.equal(summary.totals.spend, observedAmount(spend));
    assert.equal(
      summary.totals.currency,
      spend?.currency == null ? null : spend.currency,
    );
    assert.equal(summary.totals.installs, observedAmount(installs));
  }
  report.completed = completed;
  report.provider_report = harvest;
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
