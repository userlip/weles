import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('play-console-release');
const { report, request } = evidence;
report.scope = 'isolated_google_play_release';
let connected = false;
let failure;

async function run(params) {
  const admitted = await request('/run', {
    action: 'google_play_submit',
    params,
    detached: true,
  });
  const id = admitted.value.detached_run;
  assert.ok(id, JSON.stringify(admitted.value));
  evidence.runs.add(id);
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

try {
  const { values } = parseArgs({
    options: {
      'isolated-package-name': { type: 'string' },
      'stage-bundle': { type: 'string' },
      'rollout-bundle': { type: 'string' },
      'expected-rollout-status': { type: 'string' },
      proxy: { type: 'string' },
    },
  });
  for (const key of [
    'isolated-package-name',
    'stage-bundle',
    'rollout-bundle',
    'expected-rollout-status',
    'proxy',
  ]) {
    assert.ok(values[key]?.trim(), `--${key} is required`);
  }
  assert.notEqual(values['stage-bundle'], values['rollout-bundle']);
  report.fixture = {
    package_name: values['isolated-package-name'],
    stage_bundle: values['stage-bundle'],
    rollout_bundle: values['rollout-bundle'],
    track: 'internal',
    expected_rollout_status: values['expected-rollout-status'],
    proxy: values.proxy,
  };

  await evidence.connect();
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);
  connected = true;

  for (const [params, cause] of [
    [{}, 'none of TRACK is set'],
    [{ track: '__proto__' }, 'not one of internal, closed, open, production'],
  ]) {
    const refused = await run(params);
    assert.equal(refused.status, 'failed');
    assert.equal(refused.ok, false);
    assert.match(
      [refused.error, refused.stderr_tail, refused.stdout_tail].join('\n'),
      new RegExp(cause),
    );
  }

  const base = {
    package_name: values['isolated-package-name'],
    track: 'internal',
    proxy_url_override: values.proxy,
  };
  const staged = await run({
    ...base,
    bundle_path: values['stage-bundle'],
  });
  assert.equal(staged.status, 'finished', JSON.stringify(staged));
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.match(staged.stdout_tail, /PASS: staged internal release.*not sent/);
  assert.doesNotMatch(
    staged.stdout_tail,
    /clicked: the button that starts the rollout/,
  );
  report.staged = staged;

  const released = await run({
    ...base,
    bundle_path: values['rollout-bundle'],
    submit: true,
  });
  assert.equal(released.status, 'finished', JSON.stringify(released));
  assert.equal(released.ok, true, JSON.stringify(released));
  assert.ok(
    released.stdout_tail.includes(
      `status "${values['expected-rollout-status']}"`,
    ),
    JSON.stringify(released),
  );
  report.rollout = released;
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = connected ? 'failed' : 'blocked';
  report.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  await evidence.finish();
}
if (failure) throw failure;
