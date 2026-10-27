// The API owns the durable task dispatcher in this process. Native service
// control belongs to Stado; a worker request must not recreate a second daemon.

import { readFileSync } from 'node:fs';
import { createRuntimeProbe } from './worker-control/runtime.mjs';

// Whether each action changes the dispatcher; a change is a POST, a reading
// a GET. The CLI reads the same declaration.
export const workerActions = Object.freeze(
  JSON.parse(
    readFileSync(
      new URL('./worker-control/actions.json', import.meta.url),
      'utf8',
    ),
  ).mutates,
);

export function createWorkerControl(publicTaskService) {
  // The browser runtime, probed in the background from the start, so the
  // first status read already has a report or says since when it probes.
  const runtime = createRuntimeProbe();
  runtime.start();
  // The dispatcher as it stands, read without waiting on anything: what a
  // stop or start is decided on and answered with, so a control request
  // never waits on a probe of the host.
  function dispatcherStatus() {
    const dispatcher = publicTaskService.health.dispatcher;
    const running =
      dispatcher.healthy &&
      !dispatcher.draining &&
      !dispatcher.recovering &&
      !dispatcher.paused;
    return {
      schema: 'weles.worker-status.v1',
      supported: true,
      label: 'weles-task-dispatcher',
      loaded: true,
      running,
      ready: publicTaskService.health.ready,
      pid: process.pid,
      state: dispatcher.draining
        ? 'draining'
        : dispatcher.recovering
          ? 'recovering'
          : dispatcher.paused
            ? 'stopped'
            : running
              ? 'running'
              : 'failed',
      last_exit_status: null,
      dispatcher,
      prerequisites: publicTaskService.health.prerequisites,
      serviceIdentityFailure: publicTaskService.serviceIdentityFailure,
    };
  }

  // The worker's status: the dispatcher, and the browser runtime every
  // browser task needs as the last finished probe reported it, with when it
  // was probed (`browserRuntime.report` in `weles doctor`'s shape, or none
  // yet, and `probedAt`, `probingSince`, `said`). The read never waits on
  // the probe, so a hung encoder cannot hang the status that reports it.
  function workerStatus() {
    return {
      ...dispatcherStatus(),
      browserRuntime: runtime.read(),
    };
  }

  async function controlWorker(action) {
    const before = dispatcherStatus();
    if (workerActions[action] !== true) {
      return {
        ok: false,
        error: 'unsupported_worker_action',
        action,
        before,
        after: before,
      };
    }
    if (action === 'start' && before.running) {
      return { ok: true, action, changed: false, before, after: before };
    }
    if (action === 'stop' && before.dispatcher.paused) {
      return { ok: true, action, changed: false, before, after: before };
    }
    const result =
      action === 'stop'
        ? publicTaskService.stopWorker()
        : action === 'start' && before.dispatcher.paused
          ? await publicTaskService.resumeWorker()
          : await publicTaskService.restartWorker();
    return {
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      action,
      changed: result.ok,
      before,
      after: dispatcherStatus(),
    };
  }

  return Object.freeze({ workerStatus, controlWorker });
}
