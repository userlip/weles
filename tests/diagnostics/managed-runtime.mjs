// Real CLI and filesystem diagnostics; no browser, deployment or provider mutation.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceFor } from '../security/evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const evidence = await evidenceFor('managed-runtime');
const home = join(root, 'build/real-tests/managed-runtime', randomUUID());
const marker = join(home, '.stado/build-work/weles-api-managed/.weles-api-revision');
const revision = evidence.report.source_revision;
let binary;

async function doctor(label, declared = revision) {
  const env = { ...process.env, HOME: home, WELES_API_DECLARED_REVISION: declared };
  const result = spawnSync(binary, ['doctor', '--json'], { cwd: root, env, encoding: 'utf8' });
  evidence.report.operations.push({ label, command: [binary, 'doctor', '--json'],
    exit_status: result.status, signal: result.signal, stdout: result.stdout,
    stderr: result.stderr, error: result.error?.message });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const report = JSON.parse(result.stdout);
  if (!report.managedRuntime.ok) {
    assert.equal(report.ok, false);
    assert.ok(result.status, 'unhealthy managed runtime must produce a failing CLI exit');
  }
  return report.managedRuntime;
}

try {
  assert.ok(process.env.WELES_BIN?.trim(), 'WELES_BIN must name the built CLI');
  assert.ok(process.env.WELES_CLI_SHA256?.trim(), 'WELES_CLI_SHA256 must identify the tested CLI artifact');
  binary = resolve(process.env.WELES_BIN);
  const digest = createHash('sha256').update(await readFile(binary)).digest('hex');
  evidence.report.binary_sha256 = digest;
  assert.equal(digest, process.env.WELES_CLI_SHA256, 'CLI artifact differs from qualification input');
  await mkdir(dirname(marker), { recursive: true });
  const absent = await doctor('declared runtime with missing marker');
  assert.equal(absent.ok, false);
  assert.ok(absent.detail.includes(marker));
  assert.ok(absent.detail.includes(revision));
  const standalone = await doctor('caller without managed deployment', '');
  assert.equal(standalone.ok, true);
  assert.equal(standalone.builtRevision, null);
  await writeFile(marker, 'not a source revision');
  const malformed = await doctor('malformed marker');
  assert.equal(malformed.ok, false);
  assert.ok(malformed.detail.includes(marker));
  assert.ok(malformed.detail.includes('full hexadecimal source revision'));
  assert.equal(await readFile(marker, 'utf8'), 'not a source revision');
  await rm(marker);
  await mkdir(marker);
  const unreadable = await doctor('directory instead of marker');
  assert.equal(unreadable.ok, false);
  assert.ok(unreadable.detail.includes(marker));
  assert.ok(unreadable.detail.includes('EISDIR'));
  await rm(marker, { recursive: true });
  await writeFile(marker, revision);
  const ready = await doctor('matching persisted revision');
  assert.equal(ready.ok, true);
  assert.equal(ready.builtRevision, revision);
  assert.equal(ready.declaredRevision, revision);
  assert.equal(await readFile(marker, 'utf8'), revision);
  evidence.report.status = 'passed';
} catch (error) {
  evidence.report.status = 'failed';
  evidence.report.error = String(error.stack || error);
  throw error;
} finally {
  try { await rm(home, { recursive: true, force: true }); }
  finally { await evidence.finish(); }
}
