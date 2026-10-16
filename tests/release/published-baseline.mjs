// The version gate's documents follow what Stado publishes. This runs the
// real scripts/release/version/adopt-published.mjs against the real Stado:
// it reads the release Stado serves for this product, fetches that signed
// archive, and writes released-surface.json and release/version-change.json
// into a scratch copy of the checkout under build/real-tests/, never into the
// checkout itself. The written baseline must name the served version and
// carry the surface of the published payload; the declaration must name it
// as current. A missing --platform is refused before anything is read, and
// declare-candidate refuses a package.json that names the served version.
//
//   node --test tests/release/published-baseline.mjs
//
// It needs a stado on PATH that can read the release register; the report
// (revision, every command with its exit, the written documents) is kept in
// report.json beside the scratch copy.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
// https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html
const SUCCEEDED = 0;

test('the version gate documents are written from the release Stado serves', () => {
  const scratch = join(
    root,
    'build',
    'real-tests',
    'published-baseline',
    randomUUID(),
  );
  mkdirSync(join(scratch, 'release'), { recursive: true });
  for (const file of [
    '.wisent-release.json',
    'released-surface.json',
    'package.json',
  ]) {
    copyFileSync(join(root, file), join(scratch, file));
  }
  copyFileSync(
    join(root, 'release', 'version-change.json'),
    join(scratch, 'release', 'version-change.json'),
  );
  const report = { commands: [] };
  const run = (executable, args) => {
    const result = spawnSync(executable, args, {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: Number.POSITIVE_INFINITY,
    });
    report.commands.push({
      executable,
      args,
      exit: result.status,
      stderr: result.stderr.trim().split('\n').at(-1),
    });
    return result;
  };
  try {
    report.revision = run('git', ['rev-parse', 'HEAD']).stdout.trim();
    const product = JSON.parse(
      readFileSync(join(root, '.wisent-release.json'), 'utf8'),
    ).product;

    const unnamed = run(process.execPath, [
      'scripts/release/version/adopt-published.mjs',
      '--root',
      scratch,
    ]);
    assert.notEqual(unnamed.status, SUCCEEDED);
    assert.match(unnamed.stderr, /--platform is required/);

    const status = run('stado', ['release', 'status', product, '--json']);
    const served = JSON.parse(status.stdout).targets.map(
      (target) => target.desired?.version,
    );
    const adopted = run(process.execPath, [
      'scripts/release/version/adopt-published.mjs',
      '--platform',
      'darwin-arm64',
      '--root',
      scratch,
    ]);
    assert.equal(adopted.status, SUCCEEDED, adopted.stderr);
    const written = JSON.parse(adopted.stdout.trim().split('\n').at(-1));
    assert.ok(
      served.includes(written.released),
      `${written.released} is not what Stado serves: ${served.join(', ')}`,
    );

    const baseline = JSON.parse(
      readFileSync(join(scratch, 'released-surface.json'), 'utf8'),
    );
    const declaration = JSON.parse(
      readFileSync(join(scratch, 'release', 'version-change.json'), 'utf8'),
    );
    const extracted = join(
      scratch,
      '.build',
      'published',
      `${product}-${written.released}-darwin-arm64`,
      'released-surface.json',
    );
    const publishedSurface = JSON.parse(
      readFileSync(extracted, 'utf8'),
    ).surface;
    assert.equal(baseline.version, written.released);
    assert.deepEqual(baseline.surface, [...new Set(publishedSurface)].sort());
    assert.equal(declaration.current, written.released);
    report.baseline = {
      version: baseline.version,
      entries: baseline.surface.length,
    };
    report.declaration = declaration;

    const manifest = JSON.parse(
      readFileSync(join(scratch, 'package.json'), 'utf8'),
    );
    writeFileSync(
      join(scratch, 'package.json'),
      `${JSON.stringify({ ...manifest, version: written.released }, null, '  ')}\n`,
    );
    const unbumped = run(process.execPath, [
      'scripts/release/version/declare-candidate.mjs',
      '--root',
      scratch,
    ]);
    assert.notEqual(unbumped.status, SUCCEEDED);
    assert.match(unbumped.stderr, /npm version did not bump it/);
    report.verdict = 'passed';
  } finally {
    writeFileSync(
      join(scratch, 'report.json'),
      `${JSON.stringify(report, null, '  ')}\n`,
    );
  }
});
