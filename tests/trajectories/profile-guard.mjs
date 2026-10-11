import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The guard against opening a second session on a Google Ads profile, run
// through its real module with the host's real pgrep: a profile no process
// holds is free, and a pgrep that cannot run refuses rather than reading as
// "no process holds it".
const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = join(root, 'build/real-tests/profile-guard', randomUUID());
mkdirSync(directory, { recursive: true });
const report = {
  command: [process.execPath, ...process.execArgv, ...process.argv],
  source_revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  host: hostname(),
  started_at: new Date().toISOString(),
  cases: [],
};
process.once('exit', (code) => {
  report.exit_status = code;
  report.finished_at = new Date().toISOString();
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report));
});

const guard = join(root, 'src/trajectories/google/ads/_profile_guard.mjs');

// One call to the guard in a fresh Node, with `path` as its PATH.
function assertFree(profile, path) {
  return spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { assertGoogleAdsProfileNotAlreadyOpen } from ${JSON.stringify(guard)}; assertGoogleAdsProfileNotAlreadyOpen(${JSON.stringify(profile)}, 'real-test');`,
    ],
    { encoding: 'utf8', env: { ...process.env, PATH: path } },
  );
}

await test('the Google Ads profile guard tells a free profile from an unreadable process list', () => {
  const profile = join(directory, `profile-${randomUUID()}`);

  const free = assertFree(profile, process.env.PATH);
  report.cases.push({ case: 'free profile', status: free.status, stderr: free.stderr });
  assert.ok(!free.status, `a profile no process holds was refused:\n${free.stderr}`);

  const blind = assertFree(profile, directory);
  report.cases.push({ case: 'pgrep cannot run', status: blind.status, stderr: blind.stderr });
  assert.ok(blind.status, 'a guard that could not run pgrep let the session start');
  assert.match(blind.stderr, /cannot tell whether the Google Ads profile is already open/);
  assert.match(blind.stderr, /ENOENT/);
});
