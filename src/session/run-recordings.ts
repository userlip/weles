// Per-run recordings layout. Every artifact a run produces lives under
//   recordings/<run_uuid>/<action>/...
// where run_uuid is the run's own identifier: the account_action_logs row id
// the worker passes as ACTION_LOG_ID, the run id Weles's API passes as
// WELES_RUN_ID, or, for a run started by hand, an identifier this process
// draws for itself. This makes recording↔run attribution exact, survives
// label≠action mismatches, and is concurrency-safe: two runs of the same
// action never share a directory.
//
// A single run executes a trajectory that performs many actions/steps (and some
// trajectories chain multiple actions, e.g. register_then_comment), so the
// <action> segment under <run_uuid> separates those — it is NOT redundant.
//
// uploadArtifacts mirrors the whole recordings/<run_uuid>/ tree to storage at
// <run_uuid>/<...>, so anything written under the run's folder is uploaded
// regardless of which sub-action/label dir it landed in.

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** The identifier a run started by hand draws once for this process. */
let drawnRunId: string | undefined;

/**
 * The run identifier: the worker's ACTION_LOG_ID, else the API's
 * WELES_RUN_ID, else one drawn for this process, so two runs started by hand
 * never write into one shared directory.
 */
export function runId(): string {
  const declared = [process.env.ACTION_LOG_ID, process.env.WELES_RUN_ID].find(
    (id): id is string => typeof id === 'string' && id !== '',
  );
  if (declared !== undefined) return declared;
  drawnRunId ??= randomUUID();
  return drawnRunId;
}

// recordings/<run_uuid>/ — the root for everything this run produces.
export function runRecordingsRoot(): string {
  const d = join(recordingsBase(), runId());
  mkdirSync(d, { recursive: true });
  return d;
}

// Where recordings live: WELES_RECORDINGS_ROOT when the host service
// environment declares it (e.g. a larger data volume), else <cwd>/recordings,
// because the worker runs from the repo root. The worker does not read a fleet
// registry for it.
//
// Exported because the store's size is a property of the store, not of one
// run: pruning was pointed at `runRecordingsDir()`, a directory created empty
// moments earlier, so a size budget never removed a byte.
export function recordingsBase(): string {
  const declared = process.env.WELES_RECORDINGS_ROOT;
  return declared ? declared : join(process.cwd(), 'recordings');
}

// recordings/<run_uuid>/<...segments>/ (mkdir -p). Callers pass the action
// (and any deeper sub-path); the run_uuid prefix is added here. Pass no
// segment to get the run root, or, when the dispatch names an ACTION, that
// action's directory.
export function runRecordingsDir(...segments: string[]): string {
  const action = process.env.ACTION;
  const segs = !segments.length && action ? [action] : segments;
  const d = join(recordingsBase(), runId(), ...segs);
  mkdirSync(d, { recursive: true });
  return d;
}
