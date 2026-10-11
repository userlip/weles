import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('artifact-delivery-client');
const root = fileURLToPath(new URL('../../', import.meta.url));
try {
  const required = (name) => {
    const value = process.env[name]?.trim();
    assert.ok(value, `${name} must name the real qualification input`);
    return value;
  };
  assert.equal(
    (await readFile(join(root, 'release/source-commit'), 'utf8')).trim(),
    evidence.report.source_revision,
    'compiled package source identity must match the checkout',
  );
  const modulePath = join(root, 'dist/worker/artifacts/artifact-delivery-client.js');
  const digest = createHash('sha256').update(await readFile(modulePath)).digest('hex');
  evidence.report.artifact_module_sha256 = digest;
  assert.equal(digest, required('WELES_ARTIFACT_MODULE_SHA256'));
  const artifacts = JSON.parse(await readFile(required('WELES_SIGNING_ARTIFACTS_FILE'), 'utf8'));
  const operation = required('WELES_EXPECTED_SIGNING_OPERATION');
  const cause = required('WELES_EXPECTED_SIGNING_CAUSE');
  const { loadArtifactDeliveryClientConfig, requestSignedArtifactUrls } =
    await import('../../dist/worker/artifacts/artifact-delivery-client.js');
  const config = loadArtifactDeliveryClientConfig();
  await assert.rejects(requestSignedArtifactUrls(artifacts, config), (error) => {
    evidence.report.operations.push({ operation: 'requestSignedArtifactUrls', error: error.message });
    assert.ok(error.message.includes(config.baseUrl), 'refusal must identify the actual delivery service');
    assert.ok(error.message.includes(operation), 'refusal must retain the failed operation');
    assert.ok(error.message.includes(cause), 'refusal must retain the independently observed cause');
    return true;
  });
  evidence.report.status = 'passed';
} catch (error) {
  evidence.report.status = 'failed';
  evidence.report.error = error.message;
  throw error;
} finally {
  await evidence.finish();
}
