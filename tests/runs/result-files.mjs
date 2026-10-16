// What a finished run says about the result it left, as the API server's run
// outcome module reads it (src/worker/weles-api-server/run/run-outcome.mjs):
// the named documents in the run's recording tree and the last JSON line the
// trajectory printed. The journey writes real recording trees under a
// run-owned recordings directory and checks that:
//   - a generic task's result file that does not parse is named with its
//     parse error, not read as absent, and one that parses is the run's
//     generic_browser_task output;
//   - a JSON-looking stdout line that does not parse is returned beside the
//     result with its parse error, and a run that printed only such a line has
//     a null result with that line named.
// The module reads the server's configuration at import: the recordings
// directory is this run's own, and the address and port are never bound.
//
// Usage: node --test tests/runs/result-files.mjs
// With WELES_TEST_DEFECT and WELES_TEST_CRITERION named together, a passing
// run on committed source writes criterion.json under
// build/real-tests/runs/result-files-<stamp>/.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
  'src/worker/weles-api-server',
  'tests/runs',
);
assert.ok(
  !defectId || uncommitted === '',
  'commit the server and this test before qualification',
);

const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const output = resolve(
  root,
  'build',
  'real-tests',
  'runs',
  `result-files-${stamp}`,
);
const recordings = join(output, 'recordings');
mkdirSync(recordings, { recursive: true });
process.env.WELES_RECORDINGS_ROOT = recordings;
process.env.WELES_API_HOST = 'unbound.invalid';
process.env.WELES_API_PORT = 'unbound';
const { lastJsonLine, runOutputs } = await import(
  '../../src/worker/weles-api-server/run/run-outcome.mjs'
);

const observed = [];
// A run whose recording tree holds generic_task_result.json with `text`.
function recordedRun(text) {
  const runId = randomUUID();
  const directory = join(recordings, runId, 'generic');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'generic_task_result.json'), text);
  const read = runOutputs(runId);
  observed.push({ runId, written: text, read });
  return read;
}

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
  'an unreadable generic task result is named with its parse error',
  () => {
    const { outputs, errors } = recordedRun('{"status": "completed",');
    assert.ok(!('generic_browser_task' in outputs), JSON.stringify(outputs));
    const named = Object.entries(errors);
    assert.deepEqual(
      named.map(([path]) => path),
      [join('generic', 'generic_task_result.json')],
    );
    assert.match(named.flat().join(' '), /JSON/);
  },
);

journey('a generic task result that parses is the run output', () => {
  const document = { status: 'completed', answer: 'found' };
  const { outputs, errors } = recordedRun(JSON.stringify(document));
  assert.deepEqual(outputs.generic_browser_task, document);
  assert.deepEqual(errors, {});
});

journey('a result line that does not parse is named beside the result', () => {
  const read = lastJsonLine(
    'starting\n{"status": "completed"}\n{"status": truncated',
  );
  observed.push({ stdout: 'parsed line then a broken one', read });
  assert.deepEqual(read.result, { status: 'completed' });
  assert.deepEqual(
    read.unparsed.map(({ line }) => line),
    ['{"status": truncated'],
  );
  assert.match(read.unparsed.map(({ error }) => error).join(' '), /JSON/);

  const broken = lastJsonLine('starting\n{"status": truncated');
  observed.push({ stdout: 'only a broken line', read: broken });
  assert.equal(broken.result, null);
  assert.deepEqual(
    broken.unparsed.map(({ line }) => line),
    ['{"status": truncated'],
  );
});

after(() => {
  if (!defectId || completed.length !== registered.length) return;
  const digest = (path) =>
    createHash('sha256').update(readFileSync(path)).digest('hex');
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
