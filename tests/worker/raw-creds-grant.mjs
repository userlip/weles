// Real test of the raw-credentials grant on the managed Weles API.
//
// A run's result leaves the API unredacted only when the service declaration
// sets WELES_API_ALLOW_RAW_CREDS to "1". Against the worker the operator
// connection names, this journey:
//   - reads GET /healthz and records rawCredsAllowed;
//   - sends POST /run without a bearer and expects HTTP Unauthorized;
//   - when the grant is absent, sends POST /run with creds "raw" for the
//     action WELES_TEST_RAW_ACTION names and expects HTTP Forbidden
//     raw_creds_forbidden, so no trajectory starts and no result is returned;
//   - when the grant is declared, records that and starts nothing.
// The run is refused before its trajectory is resolved, so no account is used.
//
// Usage: WELES_WORKER_API_BASE=<origin> WELES_WORKER_TOKEN=<bearer>
//        WELES_TEST_RAW_ACTION=<action> node tests/worker/raw-creds-grant.mjs
// The report lands under build/real-tests/worker/raw-creds-<stamp>/.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { constants as http } from 'node:http2';
import { join } from 'node:path';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set: ${usage}`);
  return value;
}
const usage =
  'set WELES_WORKER_API_BASE, WELES_WORKER_TOKEN and WELES_TEST_RAW_ACTION';
const base = new URL(required('WELES_WORKER_API_BASE'));
const bearer = required('WELES_WORKER_TOKEN');
const action = required('WELES_TEST_RAW_ACTION');

const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const root = join('build', 'real-tests', 'worker', `raw-creds-${stamp}`);
mkdirSync(root, { recursive: true });
const report = join(root, 'report.txt');
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
writeFileSync(
  report,
  `revision: ${revision.stdout.trim()}\nendpoint: ${base.origin}\n`,
);

async function exchange(method, path, { authorized, body }) {
  const headers = { 'content-type': 'application/json' };
  if (authorized) headers.authorization = `Bearer ${bearer}`;
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  appendFileSync(report, `${method} ${path}: ${response.status} ${text}\n`);
  return { status: response.status, document: JSON.parse(text) };
}

function expect(condition, message) {
  if (!condition) {
    appendFileSync(report, `FAIL: ${message}\n`);
    throw new Error(`${message} (report: ${report})`);
  }
}

const health = await exchange('GET', '/healthz', { authorized: true });
expect(health.status === http.HTTP_STATUS_OK, 'GET /healthz did not answer OK');
const granted = health.document.rawCredsAllowed;
expect(typeof granted === 'boolean', 'GET /healthz carries no rawCredsAllowed');

const anonymous = await exchange('POST', '/run', {
  authorized: false,
  body: { action, creds: 'raw' },
});
expect(
  anonymous.status === http.HTTP_STATUS_UNAUTHORIZED,
  'POST /run without a bearer was not refused as Unauthorized',
);

if (granted) {
  appendFileSync(
    report,
    'grant declared: WELES_API_ALLOW_RAW_CREDS is set on this worker; no raw run was started\n',
  );
} else {
  const refused = await exchange('POST', '/run', {
    authorized: true,
    body: { action, creds: 'raw' },
  });
  expect(
    refused.status === http.HTTP_STATUS_FORBIDDEN &&
      refused.document.error === 'raw_creds_forbidden',
    'POST /run creds raw without the grant was not refused raw_creds_forbidden',
  );
}

appendFileSync(report, 'PASS\n');
console.log(`PASS: ${report}`);
