// How a trajectory child is placed, supervised and ended.
//
// Placement is the part that is easy to get wrong. When the API runs as a
// system LaunchDaemon and a GUI login exists, a browser started straight from
// this process has no window server; the child is therefore re-entered into the
// logged-in user's GUI bootstrap first, and only when that bootstrap cannot be
// proven does the direct spawn stand.
//
// Supervision is the same in both directions of the process group: a run ends
// when its child exits, and an abort from the caller kills the group outright,
// and stdout and stderr are kept only as bounded tails so a chatty trajectory
// cannot grow the server's heap without limit.
//
// The provider runs Brama orders for one account (./reauth-process.mjs) are
// started through the same placement, group kill and child identity defined
// here, so there is one set of rules for ending a browser.

import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import { join } from 'node:path';

import { RECORDINGS_ROOT, RUN_RESULTS_DIR } from '../configuration.mjs';
import { REPO, RUN_RELEASE_IDENTITY } from '../release-identity.mjs';
import {
  SAFE_RUN_ID,
  findResultDoc,
  lastJsonLine,
  persistRunResult,
  runOutputs,
} from './run-outcome.mjs';
import { registerRunningRun } from './running-runs.mjs';

export function signalRunProcess(child, signal) {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group may already be gone while the direct child still exits.
    }
  }
  try {
    child.kill(signal);
  } catch {
    /* already exited */
  }
}

export function trajectoryProcess(trajPath) {
  const direct = { command: process.execPath, args: [trajPath] };
  if (process.platform !== 'darwin') return direct;
  // Each reason the run starts in this process's own session rather than the
  // logged-in GUI session is said with its cause: a headed browser that then
  // cannot draw otherwise fails with nothing pointing here.
  let session;
  try {
    session = execFileSync('/bin/launchctl', ['managername'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    console.error(
      `[trajectory] launchctl managername failed, so this process's session is unknown: ${error.message}`,
    );
  }
  if (session === 'Aqua') return direct;
  const uid = process.getuid?.();
  if (!Number.isSafeInteger(uid) || uid < 0) return direct;
  try {
    execFileSync('/bin/launchctl', ['print', `gui/${uid}`], {
      stdio: 'ignore',
    });
  } catch (error) {
    console.error(
      `[trajectory] no GUI login session gui/${uid} to run ${trajPath} in (launchctl print: ${error.message}); it runs in this process's ${session} session`,
    );
    return direct;
  }
  const username = userInfo().username;
  if (!username) return direct;
  return {
    command: '/usr/bin/sudo',
    args: [
      '-n',
      '-E',
      '/bin/launchctl',
      'asuser',
      String(uid),
      '/usr/bin/sudo',
      '-n',
      '-E',
      '-u',
      username,
      process.execPath,
      trajPath,
    ],
  };
}

// The exit code a run reports when its child produced none (it failed to
// spawn or ended without one); the same value the close handlers write.
const NO_EXIT_CODE = Math.sign(-Infinity);

// What a running run has said so far, as `GET /runs` reports it: both
// streams whole, as the finished record will keep them, and when the child
// last wrote anything. A run whose last output is an hour old is waiting on
// something its last line names. The fields keep their `_tail` names because
// they are the wire contract; the 4,000/2,000-character cut is gone.
export function liveOutput(stdout, stderr, lastOutputAt) {
  return {
    last_output_at: lastOutputAt,
    stdout_tail: stdout,
    stderr_tail: stderr,
  };
}

// `outputs` are the named documents the run left in its recording tree;
// `output_errors` appears only when one of them could not be read.
function recordedOutputs(runId) {
  const { outputs, errors } = runOutputs(runId);
  return Object.keys(errors).length
    ? { outputs, output_errors: errors }
    : { outputs };
}

// What every trajectory child is told about its run, whichever path started
// it. The child writes recordings where this server reads them back
// (findResultDoc, runOutputs, diagnostics); without it a trajectory falls to
// <cwd>/recordings and every recorded output reads as absent. And a run's
// verdict does not wait on a detection probe: the probe a closing session
// runs (page script, then a third-party TLS echo) sent a signed-in browser to
// another site after the provider's pages, and a run that had already
// reported stood in it -- a sign-in after its instrumentation dump, and a
// Google authenticator enrolment for twenty minutes in the probe's WebRTC
// section after it wrote its result -- while GET /runs still read `running`.
export function runChildIdentity(runId, action) {
  return {
    WELES_FINGERPRINT: '0',
    WELES_RECORDINGS_ROOT: RECORDINGS_ROOT,
    ACTION_LOG_ID: runId,
    ACTION: action,
  };
}

// `resolveTrajectory` and `paramsToEnv` are the deployed runtime's own dispatch
// table, resolved by the entry point: this module is never the one that names a
// path inside the release tree.
export function createTrajectoryRunner({ resolveTrajectory, paramsToEnv }) {
  return function runTrajectory(
    action,
    params,
    accountId,
    freshProfile,
    runOptions = {},
  ) {
    return new Promise((resolveRun) => {
      const trajPath = resolveTrajectory(action);
      if (!trajPath) {
        resolveRun({ ok: false, error: 'no_trajectory', action });
        return;
      }
      const runId = runOptions.runId || randomUUID();
      if (!SAFE_RUN_ID.test(runId)) {
        resolveRun({ ok: false, error: 'invalid_run_id', action });
        return;
      }
      const startedAt = new Date().toISOString();
      const runResultPath = join(RUN_RESULTS_DIR, `${runId}.json`);
      try {
        persistRunResult(runResultPath, {
          ok: null,
          ...RUN_RELEASE_IDENTITY,
          action,
          run_id: runId,
          status: 'running',
          started_at: startedAt,
        });
      } catch (error) {
        resolveRun({
          ok: false,
          error: 'run_metadata_unavailable',
          action,
          run_id: runId,
          stderr_tail: String(error?.message || error),
        });
        return;
      }
      const env = {
        ...(runOptions.childEnvironment ?? process.env),
        ...(runOptions.childEnvironment
          ? {}
          : {
              WELES_FULL_DIAGNOSTICS: process.env.WELES_FULL_DIAGNOSTICS ?? '1',
            }),
        ...paramsToEnv(params || {}, action, trajPath),
        ...(accountId ? { ACCOUNT_ID: String(accountId) } : {}),
        ...(freshProfile ? { WELES_FRESH_PROFILE: '1' } : {}),
        ...(runOptions.extraEnv || {}),
        ...runChildIdentity(runId, action),
      };
      const processSpec = trajectoryProcess(trajPath);
      const child = spawn(processSpec.command, processSpec.args, {
        cwd: REPO,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      let stdout = '';
      let stderr = '';
      let lastOutputAt = null;
      let cancelled = false;
      let cancelDetail = null;
      let settled = false;
      // Every `STEP <name>` line the trajectory writes is a stage, as for a
      // sign-in: an enrolment that stood for minutes on a Google page said
      // only how long ago it last wrote, so nobody could tell which step held it.
      const stages = [];
      let lastStage = null;
      let pendingLine = '';
      const readStages = (chunk) => {
        const lines = `${pendingLine}${chunk}`.split('\n');
        pendingLine = lines.pop();
        for (const line of lines) {
          const step = /^STEP (?<name>\S+)\s*$/.exec(line);
          if (!step) continue;
          lastStage = { stage: step.groups.name, at: new Date().toISOString() };
          stages.push(lastStage);
          try {
            persistRunResult(runResultPath, {
              ok: null,
              ...RUN_RELEASE_IDENTITY,
              action,
              run_id: runId,
              status: 'running',
              started_at: startedAt,
              stages,
            });
          } catch {
            /* the stage is still reported live by describe() */
          }
        }
      };
      const abortRun = () => {
        cancelled = true;
        signalRunProcess(child, 'SIGKILL');
      };
      const unregister = registerRunningRun(runId, {
        action,
        kind: 'run',
        startedAt,
        cancel: (detail) => {
          cancelDetail = detail;
          abortRun();
        },
        describe: () => ({
          stage: lastStage,
          ...liveOutput(stdout, stderr, lastOutputAt),
        }),
      });
      const finish = (result) => {
        if (settled) return;
        settled = true;
        unregister();
        runOptions.signal?.removeEventListener('abort', abortRun);
        if (cancelDetail !== null)
          result = {
            ...result,
            ok: false,
            cancelled: true,
            cancel_detail: cancelDetail,
          };
        result = { ...result, stages };
        try {
          persistRunResult(runResultPath, {
            ...result,
            ...RUN_RELEASE_IDENTITY,
            action,
            run_id: runId,
            status: 'finished',
            started_at: startedAt,
            completed_at: new Date().toISOString(),
          });
        } catch (error) {
          result = {
            ...result,
            metadata_error: `run metadata could not be completed: ${String(error?.message || error)}`,
          };
        }
        resolveRun(result);
      };
      if (runOptions.signal?.aborted) abortRun();
      else
        runOptions.signal?.addEventListener('abort', abortRun, { once: true });
      child.stdout.on('data', (chunk) => {
        lastOutputAt = new Date().toISOString();
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        lastOutputAt = new Date().toISOString();
        stderr += chunk.toString();
      });
      child.stderr.on('data', (chunk) => readStages(String(chunk)));
      child.once('error', (error) => {
        finish({
          ok: false,
          exitCode: NO_EXIT_CODE,
          action,
          run_id: runId,
          result: null,
          ...recordedOutputs(runId),
          stdout_tail: stdout,
          stderr_tail: `${stderr}\n${String(error?.message || error)}`,
          cancelled,
        });
      });
      child.on('close', (code) => {
        const exitCode = cancelled ? 137 : (code ?? -1);
        const result = lastJsonLine(stdout) ?? findResultDoc(runId);
        finish({
          ok: !exitCode,
          exitCode,
          action,
          run_id: runId,
          result,
          ...recordedOutputs(runId),
          stdout_tail: stdout,
          stderr_tail: stderr,
          cancelled,
        });
      });
    });
  };
}
