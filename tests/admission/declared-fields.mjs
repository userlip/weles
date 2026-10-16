// What the public task service admits, as POST /api/v1/tasks and its cancel
// route parse a body (src/worker/public-task-service/admission.mjs) under a
// configuration loadConfig reads from a real environment: a generated receipt
// key pair, a tenant id and an allowed origin. The journey checks that:
//   - a task, its input or a cancellation carrying a field its schema does
//     not declare is refused, every undeclared and every missing field named
//     by its path, whatever the field is called;
//   - a task carrying exactly its declared fields passes field admission and
//     is refused only where its Spis binding is checked;
//   - a cancellation carrying exactly its declared fields is admitted.
//
// Usage: node --test tests/admission/declared-fields.mjs
// With WELES_TEST_DEFECT and WELES_TEST_CRITERION named together, a passing
// run on committed source writes criterion.json under
// build/real-tests/admission/declared-fields-<stamp>/.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CANCELLATION_SCHEMA,
  TASK_SCHEMA,
  PUBLIC_ACTION,
  loadConfig,
  parseCancellation,
  parseTaskRequest,
} from '../../src/worker/public-task-service/admission.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const defectId = process.env.WELES_TEST_DEFECT?.trim();
const criterion = process.env.WELES_TEST_CRITERION?.trim();
assert.equal(
  Boolean(defectId),
  Boolean(criterion),
  'WELES_TEST_DEFECT and WELES_TEST_CRITERION are named together or not at all',
);

// The shell's statuses (https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html).
const SUCCEEDED = 0;

const commands = [];
function git(...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, SUCCEEDED, result.stderr);
  commands.push({
    executable: 'git',
    args: ['-C', root, ...args],
    exit: result.status,
  });
  return result.stdout.trim();
}
const revision = git('rev-parse', 'HEAD');
const uncommitted = git(
  'status',
  '--porcelain',
  '--',
  'src/worker/public-task-service',
  'tests/admission',
);
assert.ok(
  !defectId || uncommitted === '',
  'commit the admission source and this test before qualification',
);

const origin = 'https://shop.invalid';
const keyId = 'receipt-key';
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const pem = (key, type) => key.export({ format: 'pem', type });
const config = loadConfig(
  {
    WELES_PUBLIC_API_BEARER: randomUUID(),
    WELES_PUBLIC_API_ORGANIZATION_ID: randomUUID(),
    WELES_RECEIPT_KEY_ID: keyId,
    WELES_RECEIPT_KEY_SET_VERSION: 'receipt-keys',
    WELES_RECEIPT_PRIVATE_KEY: pem(privateKey, 'pkcs8'),
    WELES_RECEIPT_PUBLIC_KEYS_JSON: JSON.stringify({
      [keyId]: pem(publicKey, 'spki'),
    }),
    WELES_PUBLIC_API_ALLOWED_ORIGINS: origin,
  },
  {
    version: 'browser-evidence',
    constraints: ['network:exact-public-origin-pinned'],
  },
);

// A task carrying exactly the fields weles.task.current declares.
function declaredTask() {
  return {
    schema: TASK_SCHEMA,
    organizationId: config.organizationId,
    origin,
    action: PUBLIC_ACTION,
    input: {
      product_url: `${origin}/`,
      objective: 'Record the pricing page',
      constraints: [...config.policy.constraints],
      spisBinding: {},
    },
    credentialRefs: [],
    evidencePolicy: 'full',
    justification: 'evidence for a catalogue record',
  };
}

// The refusal `parse` throws, as the service would answer it.
function refusal(parse) {
  const answers = [];
  assert.throws(parse, (error) => {
    answers.push({ code: error.code, message: error.message });
    return true;
  });
  const [answer] = answers;
  return answer;
}

const observed = [];
const registered = [];
const completed = [];
function journey(name, body) {
  registered.push(name);
  test(name, () => {
    body();
    completed.push(name);
  });
}

journey(
  'an undeclared task field is refused by path, whatever its name',
  () => {
    const task = declaredTask();
    for (const name of ['api_key', 'bearer', 'credentials']) task[name] = 'x';
    delete task.justification;
    const answer = refusal(() => parseTaskRequest(task, config));
    assert.equal(answer.code, 'invalid-task');
    for (const path of [
      'task.api_key',
      'task.bearer',
      'task.credentials',
      'task.justification',
    ])
      assert.ok(answer.message.includes(path), answer.message);
    observed.push(answer);
  },
);

journey(
  'an undeclared input field is refused by path, whatever its name',
  () => {
    const task = declaredTask();
    for (const name of ['passwd', 'session', 'token_count'])
      task.input[name] = 'x';
    const answer = refusal(() => parseTaskRequest(task, config));
    assert.equal(answer.code, 'invalid-input');
    for (const path of [
      'task.input.passwd',
      'task.input.session',
      'task.input.token_count',
    ])
      assert.ok(answer.message.includes(path), answer.message);
    observed.push(answer);
  },
);

journey('a task of declared fields is refused only at its Spis binding', () => {
  const answer = refusal(() => parseTaskRequest(declaredTask(), config));
  assert.equal(answer.code, 'invalid-spis-binding');
  observed.push(answer);
});

journey('an undeclared cancellation field is refused by path', () => {
  const answer = refusal(() =>
    parseCancellation(
      {
        schema: CANCELLATION_SCHEMA,
        organizationId: config.organizationId,
        reason: 'superseded',
        cookie: 'x',
      },
      config,
    ),
  );
  assert.equal(answer.code, 'invalid-cancellation');
  assert.ok(answer.message.includes('cancellation.cookie'), answer.message);
  observed.push(answer);
});

journey('a cancellation of declared fields is admitted', () => {
  const admitted = parseCancellation(
    {
      schema: CANCELLATION_SCHEMA,
      organizationId: config.organizationId,
      reason: 'superseded',
    },
    config,
  );
  assert.deepEqual(admitted, {
    organizationId: config.organizationId,
    reason: 'superseded',
  });
  observed.push({ admitted: admitted.reason });
});

after(() => {
  if (!defectId || completed.length !== registered.length) return;
  const digest = (path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const output = resolve(
    root,
    'build',
    'real-tests',
    'admission',
    `declared-fields-${stamp}`,
  );
  mkdirSync(output, { recursive: true });
  const path = join(output, 'criterion.json');
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        defectId,
        criterion,
        sourceRevision: revision,
        result: 'passed',
        binarySha256: digest(process.execPath),
        testSha256: digest(fileURLToPath(import.meta.url)),
        observedFinalState: { cases: completed, observed },
        commands,
      },
      null,
      '  ',
    )}\n`,
    { mode: constants.S_IRUSR | constants.S_IWUSR },
  );
  console.log(`criterion report: ${path}`);
});
