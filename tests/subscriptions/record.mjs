import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceFor } from '../security/evidence.mjs';
import { activeSkarbiecBinary } from '../../src/_shared/skarbiec-runtime.mjs';

const evidence = await evidenceFor('subscription-record');
const { report } = evidence;
const root = fileURLToPath(new URL('../../', import.meta.url));
let failure;
let initialized = false;

function command(program, args, input) {
  const result = spawnSync(program, args, {
    encoding: 'utf8',
    cwd: root,
    env: process.env,
    input,
  });
  report.operations.push({
    command: [program, ...args],
    exit_status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.ok(Number.isInteger(result.status), JSON.stringify(result));
  return result;
}

function accepted(program, args, input) {
  const result = command(program, args, input);
  assert.ok(!result.status, result.stderr);
  return result.stdout;
}

try {
  const directory = join(
    root,
    'build/real-tests/subscription-record',
    randomUUID(),
  );
  const gnupg = join(directory, 'gnupg');
  mkdirSync(gnupg, { recursive: true, mode: constants.S_IRWXU });
  process.env.GNUPGHOME = gnupg;
  process.env.SKARBIEC_VAULT_FILE = join(directory, 'vault.json');
  report.vault_file = process.env.SKARBIEC_VAULT_FILE;
  const skarbiec = activeSkarbiecBinary();
  report.skarbiec_binary_sha256 = createHash('sha256')
    .update(readFileSync(skarbiec))
    .digest('hex');
  accepted(skarbiec, ['init', 'Weles subscription record test']);
  initialized = true;
  const cli = 'src/lib/service_subscriptions.mjs';
  const run = (args) => command(process.execPath, [cli, ...args]);
  const pass = (args) => {
    const result = run(args);
    assert.ok(!result.status, result.stderr);
    return JSON.parse(result.stdout);
  };
  const refuse = (args, cause) => {
    const result = run(args);
    assert.ok(result.status, JSON.stringify(result));
    assert.ok(result.stderr.includes(cause), result.stderr);
  };
  const row = {
    service_name: 'Weles record fixture',
    provider: 'fixture',
    account_identifier: randomUUID(),
    status: 'unknown',
    last_verified_at: new Date().toISOString(),
    metadata: { observation: 'no provider state asserted' },
  };
  const before = pass(['list']);
  assert.deepEqual(before, []);
  const withoutStatus = { ...row };
  delete withoutStatus.status;
  refuse(['upsert', JSON.stringify(withoutStatus)], 'status');
  const withoutTime = { ...row };
  delete withoutTime.last_verified_at;
  refuse(['upsert', JSON.stringify(withoutTime)], 'last_verified_at');
  refuse(
    ['upsert', JSON.stringify({ ...row, account_identifier: '' })],
    'account_identifier',
  );
  refuse(['upsert', JSON.stringify({ ...row, status: '  ' })], 'status');
  refuse(
    ['upsert', JSON.stringify({ ...row, last_verified_at: 'not a date' })],
    'last_verified_at must be a date-time',
  );
  assert.deepEqual(
    pass(['list']),
    before,
    'refusals must not write a vault item',
  );

  const [saved] = pass(['upsert', JSON.stringify(row)]);
  assert.ok(saved.id);
  assert.equal(saved.status, row.status);
  assert.equal(saved.last_verified_at, row.last_verified_at);
  assert.equal(pass(['get', saved.id]).status, row.status);
  assert.equal(
    pass(['list']).find((item) => item.id === saved.id)?.last_verified_at,
    row.last_verified_at,
  );

  refuse(
    ['update', saved.id, JSON.stringify({ status: 'unknown' })],
    'supplied together',
  );
  assert.equal(pass(['get', saved.id]).last_verified_at, row.last_verified_at);
  const changed = {
    status: 'unknown',
    last_verified_at: new Date().toISOString(),
  };
  const [updated] = pass(['update', saved.id, JSON.stringify(changed)]);
  assert.equal(updated.status, changed.status);
  assert.equal(updated.last_verified_at, changed.last_verified_at);
  assert.equal(
    pass(['get', saved.id]).last_verified_at,
    changed.last_verified_at,
  );

  const deleted = pass(['delete', saved.id]);
  assert.equal(deleted.deleted, true);
  assert.deepEqual(pass(['list']), []);
  refuse(['get', saved.id], 'not found');
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = initialized ? 'failed' : 'blocked';
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
} finally {
  await evidence.finish();
}
if (failure) throw failure;
