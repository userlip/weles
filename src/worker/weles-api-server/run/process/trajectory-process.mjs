// How an ordinary trajectory child is started, supervised and ended.
//
// Supervision is the same in both directions of the process group: a run ends
// when its child exits, and an abort from the caller kills the group outright.
// Placement, group kill and the child's identity are ./placement.mjs, shared
// with the provider runs Brama orders (./reauth-process.mjs).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { RUN_RESULTS_DIR } from '../../configuration.mjs';
import { REPO, RUN_RELEASE_IDENTITY } from '../../release-identity.mjs';
import {
  SAFE_RUN_ID,
  findResultDoc,
  lastJsonLine,
  persistRunResult,
} from '../run-outcome.mjs';
import { registerRunningRun } from '../running-runs.mjs';
import {
  liveOutput,
  NO_EXIT_CODE,
  recordedOutputs,
  runChildIdentity,
  signalRunProcess,
  trajectoryProcess,
} from './placement.mjs';

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
