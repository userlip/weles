import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Trajectory } from '../../dist/agent/flows/trajectory-cache.js';
import { FetchAccountValue } from '../../dist/agent/flows/tasks.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const reports = join(root, 'build/real-tests/agent');
mkdirSync(reports, { recursive: true });
const directory = mkdtempSync(join(reports, 'trajectory-cache-'));
const report = {
  source_revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  command: [process.execPath, ...process.execArgv, ...process.argv],
  cases: [],
};
process.once('exit', (code) => {
  report.exit_status = code;
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report));
});

const learned = {
  service: 'example-billing',
  finalUrl: 'https://billing.example.test/account',
  selector: '#balance',
  lastSuccess: new Date().toISOString(),
  lastValue: Math.PI,
};

await test('a service with no learned route reads as none', () => {
  const cacheDir = mkdtempSync(join(directory, 'none-'));
  assert.equal(Trajectory.load(cacheDir, learned.service), null);
  report.cases.push('none');
});

await test('a saved route reads back as the same route', () => {
  const cacheDir = mkdtempSync(join(directory, 'roundtrip-'));
  new Trajectory(learned).save(cacheDir);
  assert.deepEqual({ ...Trajectory.load(cacheDir, learned.service) }, learned);
  report.cases.push('roundtrip');
});

await test('an unreadable cache entry is refused with its path', () => {
  const cacheDir = mkdtempSync(join(directory, 'unreadable-'));
  const path = Trajectory.path(cacheDir, learned.service);
  writeFileSync(path, '{ not json');
  assert.throws(() => Trajectory.load(cacheDir, learned.service), {
    message: new RegExp(
      `^trajectory cache ${path} cannot be read: SyntaxError`,
    ),
  });
  report.cases.push('unreadable');
});

await test('a cache entry that is not a learned route is refused with what it holds', () => {
  const cacheDir = mkdtempSync(join(directory, 'shape-'));
  const path = Trajectory.path(cacheDir, learned.service);
  const { selector: _selector, ...withoutSelector } = learned;
  writeFileSync(path, JSON.stringify(withoutSelector));
  assert.throws(() => Trajectory.load(cacheDir, learned.service), {
    message: `trajectory cache ${path} is not a learned route: ${JSON.stringify(withoutSelector)}`,
  });
  report.cases.push('shape');
});

await test('invalidating removes a learned route and accepts one never learned', () => {
  const cacheDir = mkdtempSync(join(directory, 'invalidate-'));
  new Trajectory(learned).save(cacheDir);
  Trajectory.invalidate(cacheDir, learned.service);
  assert.equal(existsSync(Trajectory.path(cacheDir, learned.service)), false);
  Trajectory.invalidate(cacheDir, learned.service);
  report.cases.push('invalidate');
});

for (const name of ['osTarget', 'trajectoryCacheDir']) {
  await test(`FetchAccountValue refuses a missing ${name} by name`, () => {
    const config = {
      service: learned.service,
      url: learned.finalUrl,
      what: 'the account balance',
      secretService: 'oxylabsResidential',
      osTarget: 'macos',
      trajectoryCacheDir: directory,
    };
    delete config[name];
    assert.throws(() => new FetchAccountValue(config), {
      message: `FetchAccountValue needs ${name}: it is stated by the caller, never assumed`,
    });
    report.cases.push(`refuse-${name}`);
  });
}
console.log(`agent report: ${join(directory, 'report.json')}`);
