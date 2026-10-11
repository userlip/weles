import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('artifact-filesystem-admission');
const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = join(
  root,
  'build/real-tests/artifact-filesystem-fixtures',
  randomUUID(),
);
const previousRoot = process.env.WELES_RECORDINGS_ROOT;
try {
  const required = (name) => {
    const value = process.env[name]?.trim();
    assert.ok(value, `${name} must name the real qualification input`);
    return value;
  };
  required('STADO_API_URL');
  required('WELES_STADO_OBJECT_API_TOKEN');
  assert.equal(
    (await readFile(join(root, 'release/source-commit'), 'utf8')).trim(),
    evidence.report.source_revision,
    'compiled package source identity must match the checkout',
  );
  const modulePath = join(root, 'dist/worker/upload-artifacts.js');
  const digest = createHash('sha256')
    .update(await readFile(modulePath))
    .digest('hex');
  evidence.report.artifact_module_sha256 = digest;
  assert.equal(digest, required('WELES_ARTIFACT_MODULE_SHA256'));
  await mkdir(fixture, { recursive: true });
  process.env.WELES_RECORDINGS_ROOT = fixture;
  const { uploadArtifacts } = await import(
    '../../dist/worker/upload-artifacts.js'
  );
  const notDirectory = randomUUID();
  const marker = 'qualification-owned non-directory artifact root';
  await writeFile(join(fixture, notDirectory), marker);
  for (const [run, code] of [
    [notDirectory, 'ENOTDIR'],
    [randomUUID(), 'ENOENT'],
  ]) {
    await assert.rejects(uploadArtifacts(run), (error) => {
      evidence.report.operations.push({
        operation: 'uploadArtifacts',
        run,
        error: error.message,
      });
      assert.ok(error.message.includes('Artifact directory read failed'));
      assert.ok(error.message.includes(join(fixture, run)));
      assert.ok(error.message.includes(code));
      return true;
    });
  }
  assert.equal(await readFile(join(fixture, notDirectory), 'utf8'), marker);
  const empty = randomUUID();
  await mkdir(join(fixture, empty));
  const result = await uploadArtifacts(empty);
  evidence.report.operations.push({
    operation: 'uploadArtifacts',
    run: empty,
    result,
  });
  assert.equal(result, null, 'an observed empty tree has no artifacts');
  await assert.rejects(readFile(join(fixture, empty, '.uploaded.json')), {
    code: 'ENOENT',
  });
  evidence.report.status = 'passed';
} catch (error) {
  evidence.report.status = 'failed';
  evidence.report.error = error.message;
  throw error;
} finally {
  if (previousRoot === undefined) delete process.env.WELES_RECORDINGS_ROOT;
  else process.env.WELES_RECORDINGS_ROOT = previousRoot;
  try {
    await rm(fixture, { recursive: true, force: true });
  } finally {
    await evidence.finish();
  }
}
