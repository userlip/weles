// What a run leaves behind, and when two identical requests are one run.
//
// A run outlives the request that asked for it. Its outcome is therefore
// written to a file named by run id, atomically and owner-only, before the
// child is even spawned and again when it settles -- that document is what a
// caller who lost its socket reads afterwards, and what the diagnostics route
// serves. Beside it sit the readers of what the run itself produced: the last
// JSON line the trajectory printed, with every later line that looked like JSON
// and did not parse, and the named documents every trajectory leaves in its
// recording tree (Pangram verdict, ban signal, generic task result, pending
// review, ...), keyed the way run callers read them.
//
// Coalescing belongs to the same subject because it decides how many outcomes
// exist. A browser login costs a real sign-in on a real account, so two callers
// asking for the same one within the deduplication window join a single run and
// read a single outcome instead of burning the account twice.

import { createHash } from 'node:crypto';
import {
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  realpathSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import { RECORDINGS_ROOT, RUN_RESULTS_DIR } from '../configuration.mjs';

// A run id names its result file, so it is one path segment: a letter or
// digit, then letters, digits, `_` and `-`; the filesystem refuses a name it
// cannot hold.
export const SAFE_RUN_ID = /^[^\W_][\w-]*$/;

// Results are the owner's alone: the directory searchable and the files
// readable and writable by the owner only.
const OWNER_DIRECTORY = constants.S_IRWXU;
const OWNER_FILE = constants.S_IRUSR | constants.S_IWUSR;

export function persistRunResult(path, document) {
  mkdirSync(RUN_RESULTS_DIR, { recursive: true, mode: OWNER_DIRECTORY });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(document), { mode: OWNER_FILE });
  renameSync(temporary, path);
}

// A run a caller names: its result file is created only if it does not exist
// yet, in one exclusive step, so two requests carrying the same run id start
// one run. Answers false when the run already exists.
export function claimRunResult(path, document) {
  mkdirSync(RUN_RESULTS_DIR, { recursive: true, mode: OWNER_DIRECTORY });
  try {
    writeFileSync(path, JSON.stringify(document), {
      mode: OWNER_FILE,
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export function runResultFile(runId) {
  const candidate = join(RUN_RESULTS_DIR, `${runId}.json`);
  try {
    const resultsRoot = realpathSync(RUN_RESULTS_DIR);
    const lstat = lstatSync(candidate);
    if (lstat.isSymbolicLink() || !lstat.isFile()) return null;
    const path = realpathSync(candidate);
    if (!path.startsWith(`${resultsRoot}${sep}`)) return null;
    return { path, stat: statSync(path) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Watch the directory, not the file: persisting an outcome replaces its inode.
// Arm before reading so a completion between admission and this read is retained.
export function terminalRunResultFile(runId, signal) {
  signal?.throwIfAborted();
  if (!SAFE_RUN_ID.test(runId)) throw new Error('invalid_run_id');
  if (!runResultFile(runId)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, file) => {
      if (finished) return;
      finished = true;
      watcher.close();
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(file);
    };
    const onAbort = () =>
      finish(
        new Error(`terminal result read for ${runId} was cancelled`, {
          cause: signal.reason,
        }),
      );
    const read = () => {
      try {
        const file = runResultFile(runId);
        if (!file)
          throw new Error(`run ${runId}: persisted result disappeared`);
        const result = JSON.parse(readFileSync(file.path, 'utf8'));
        // A running record holds ok=null; an ended one holds its verdict in
        // ok, whatever word its status uses for the ending.
        const running = result.status === 'running';
        const verdict = typeof result.ok === 'boolean';
        if (running && result.ok === null) return;
        if (verdict && !running) {
          finish(null, file);
          return;
        }
        throw new Error(
          `run ${runId}: invalid persisted outcome status=${JSON.stringify(result.status)} ok=${JSON.stringify(result.ok)}`,
        );
      } catch (error) {
        finish(
          new Error(`read terminal result for ${runId}: ${error.message}`, {
            cause: error,
          }),
        );
      }
    };
    const watcher = watch(RUN_RESULTS_DIR, (event, filename) => {
      if (
        event === 'rename' &&
        String(filename) === basename(RUN_RESULTS_DIR)
      ) {
        finish(
          new Error(
            `watch terminal result for ${runId}: result directory was moved or removed`,
          ),
        );
      } else if (filename === null || String(filename) === `${runId}.json`) {
        read();
      }
    });
    watcher.once('error', (error) =>
      finish(
        new Error(`watch terminal result for ${runId}: ${error.message}`, {
          cause: error,
        }),
      ),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else read();
  });
}

// The last line of `stdout` that parses as JSON, as `result` (null when none
// does), and every later line that began like JSON and did not parse, as
// `unparsed` entries of {line, error}: a reader can tell a run that printed no
// result from one whose result line could not be read.
export function lastJsonLine(stdout) {
  const lines = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') || l.startsWith('['));
  const unparsed = [];
  for (const line of lines.reverse()) {
    try {
      return { result: JSON.parse(line), unparsed };
    } catch (error) {
      unparsed.unshift({ line, error: String(error?.message || error) });
    }
  }
  return { result: null, unparsed };
}

// Which recording file a caller reads under which key. The table is the one the
// database-polled worker assembled into each run's result before it was removed;
// echo-web's job pages, the Pangram check and the logs route still read it.
const RUN_OUTPUT_FILES = Object.freeze({
  'pangram_result.json': 'pangram',
  'generic_task_result.json': 'generic_browser_task',
  'ban_signal.json': 'ban_signal',
  'pending_review.json': 'pending_review',
  'service_action_result.json': 'service_action',
  'capture_result.json': 'capture',
  'accessibility_audit_result.json': 'accessibility_audit',
  'captcha_events.json': 'captcha',
  'overleaf_version_history_summary.json': 'overleaf_version_history_summary',
  'yahoo_register_result.json': 'yahoo_register',
  'report_harvest.json': 'apple_ads_report_harvest',
});

// The run's recording tree, resolved inside the recordings directory: none
// when the run recorded nothing, and an error naming why for a root that is a
// link, not a directory, resolves elsewhere or cannot be read.
function recordingTrees(runId) {
  const runRoot = join(RECORDINGS_ROOT, runId);
  const metadata = lstatSync(runRoot, { throwIfNoEntry: false });
  if (!metadata) return [];
  if (metadata.isSymbolicLink() || !metadata.isDirectory())
    throw new Error('recording root is a symbolic link or not a directory');
  const realRunRoot = realpathSync(runRoot);
  if (!realRunRoot.startsWith(`${realpathSync(RECORDINGS_ROOT)}${sep}`))
    throw new Error('recording root resolves outside the recordings directory');
  return [realRunRoot];
}

// The named documents anywhere under recordings/<run>/, read without following
// a link out of the run's tree (a symbolic link is never descended). A file that
// does not parse is reported by name under output_errors rather than dropped,
// so a reader can tell unreadable from absent.
export function runOutputs(runId) {
  const outputs = {};
  const errors = {};
  const visit = (root, directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      errors[join('.', relative(root, directory))] = String(
        error?.message || error,
      );
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(root, path);
        continue;
      }
      const key = RUN_OUTPUT_FILES[entry.name];
      if (!entry.isFile() || !key || key in outputs) continue;
      try {
        outputs[key] = JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        errors[relative(root, path)] = String(error?.message || error);
      }
    }
  };
  try {
    for (const root of recordingTrees(runId)) visit(root, root);
  } catch (error) {
    errors['.'] = String(error?.message || error);
  }
  return { outputs, errors };
}

const coalescedRuns = new Map();

export function runAdmissionKey(kind, identity) {
  return `${kind}:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
}

// Requests for the same account join the run already acting on it, so two
// callers never drive one account at once. A run leaves the table the moment
// it ends, whatever it ended with: the next request starts a run of its own.
// Keeping finished runs for a window handed a failed sign-in back to the
// retry that came after it, so a repaired trajectory could not be tried; a
// caller that lost a detached run's answer reads its result file instead.
export function coalesceRun(key, start, metadata = {}) {
  const existing = coalescedRuns.get(key);
  if (existing) return { entry: existing, joined: true };
  const entry = { promise: null, metadata };
  entry.promise = Promise.resolve()
    .then(start)
    .finally(() => {
      if (coalescedRuns.get(key) === entry) coalescedRuns.delete(key);
    });
  coalescedRuns.set(key, entry);
  return { entry, joined: false };
}
