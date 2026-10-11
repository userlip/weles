import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { evidenceFor } from '../evidence.mjs';

const evidence = await evidenceFor('acquisition-refusal');
try {
  const required = (name) => {
    const value = process.env[name]?.trim();
    assert.ok(value, `${name} must name the actual isolated qualification input`);
    return value;
  };
  const script = fileURLToPath(new URL('../../../src/worker/deploy/acquire/skarbiec-acquire.mjs', import.meta.url));
  const args = [script, required('WELES_TEST_ACQUISITION_SCOPE_FILE'),
    required('WELES_TEST_ACQUISITION_CONSUMER'), required('WELES_TEST_ACQUISITION_ITEM'),
    required('WELES_TEST_ACQUISITION_FIELD')];
  const expectedExit = Number(required('WELES_TEST_ACQUISITION_EXIT'));
  assert.ok(Number.isInteger(expectedExit));
  const reason = required('WELES_TEST_ACQUISITION_REASON');
  const cause = required('WELES_TEST_ACQUISITION_CAUSE');
  const operation = required('WELES_TEST_ACQUISITION_OPERATION');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  evidence.report.operations.push({ command: [process.execPath, ...args],
    exit_status: result.status, stderr: result.stderr, error: result.error?.message,
    stdout: '[credential output omitted]' });
  assert.ifError(result.error);
  assert.equal(result.status, expectedExit);
  assert.equal(result.stdout, '', 'refusal must not emit a credential');
  assert.ok(result.stderr.includes(`SKARBIEC_ACQUIRE_REASON ${reason}`));
  assert.ok(result.stderr.includes(operation), 'refusal lost the actual failed operation');
  assert.ok(result.stderr.includes(cause), 'refusal lost the independently observed cause');
  evidence.report.status = 'passed';
} catch (error) {
  evidence.report.status = 'failed';
  evidence.report.error = error.message;
  throw error;
} finally {
  await evidence.finish();
}
