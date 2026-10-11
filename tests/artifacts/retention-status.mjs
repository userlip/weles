import assert from 'node:assert/strict';
import { TERMINAL_STATUSES } from '../../src/worker/public-task-service/wire.mjs';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('artifact-retention-status');
try {
  const required = (name) => {
    const value = process.env[name]?.trim();
    assert.ok(value, `${name} must name the real qualification input`);
    return value;
  };
  const base = required('WELES_PUBLIC_TASK_API_BASE');
  const bearer = required('WELES_PUBLIC_TASK_BEARER');
  const taskId = required('WELES_RETENTION_TASK_ID');
  const expectedCause = required('WELES_EXPECTED_RETENTION_CAUSE');
  const expectedOperation = required('WELES_EXPECTED_RETENTION_OPERATION');
  const expectedResource = required('WELES_EXPECTED_RETENTION_RESOURCE');
  const expectedOrganization = required('WELES_RETENTION_ORGANIZATION');
  const expectedStatus = required('WELES_RETENTION_TASK_STATUS');
  assert.ok(!Object.hasOwn(TERMINAL_STATUSES, expectedStatus));
  async function get(path, authenticated) {
    const endpoint = new URL(path, base);
    assert.ok(
      !endpoint.username && !endpoint.password,
      'credentials must remain in the bearer header',
    );
    const response = await fetch(endpoint, {
      headers: authenticated ? { Authorization: `Bearer ${bearer}` } : {},
      redirect: 'error',
    });
    const text = await response.text();
    assert.ok(
      !text.includes(bearer),
      'task response must not expose its bearer',
    );
    evidence.report.operations.push({
      method: 'GET',
      endpoint: endpoint.href,
      authenticated,
      http_status: response.status,
      body: text,
    });
    return { response, value: JSON.parse(text) };
  }
  const version = await get('/api/v1/version', false);
  assert.equal(version.value.sourceRevision, evidence.report.source_revision);
  const path = `/api/v1/tasks/${encodeURIComponent(taskId)}`;
  const unauthorized = await get(path, false);
  assert.ok(!unauthorized.response.ok);
  assert.equal(unauthorized.value.error, 'unauthorized');
  assert.equal(unauthorized.value.evidenceError, undefined);
  const observed = await get(path, true);
  assert.ok(observed.response.ok);
  assert.equal(observed.value.schema, 'weles.task-status.v1');
  assert.equal(observed.value.taskId, taskId);
  assert.equal(observed.value.organizationId, expectedOrganization);
  assert.equal(observed.value.status, expectedStatus);
  assert.equal(observed.value.receipt, undefined);
  assert.equal(typeof observed.value.evidenceError, 'string');
  assert.ok(observed.value.evidenceError.includes(expectedCause));
  assert.ok(observed.value.evidenceError.includes(expectedOperation));
  assert.ok(observed.value.evidenceError.includes(expectedResource));
  evidence.report.status = 'passed';
} catch (error) {
  evidence.report.status = 'failed';
  evidence.report.error = error.message;
  throw error;
} finally {
  await evidence.finish();
}
