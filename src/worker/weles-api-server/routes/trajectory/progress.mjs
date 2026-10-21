// One admitted run answered as it goes, one JSON object per line: `admitted`,
// everything the run reports (`started`, every `stage`, an
// `operator_request` when it waits for a person) and, last, `result`. A
// browser run has no clock that ends it, so a caller that only got the
// verdict could only wait in silence. A caller that joins a run already under
// way is first sent everything that run has reported. /reauth,
// /subscriptions/acquire and /reauth/authorize answer this way.
import { constants as http } from 'node:http2';
import { coalesceRun } from '../../run/run-outcome.mjs';

/** One JSON object per line; the last line is the `result` event. */
export const PROGRESS_CONTENT_TYPE = 'application/x-ndjson';

/**
 * Stream the run admitted under `key`, started by `start(publish)` unless one
 * is already under way. `failed(error)` is the outcome of a run that threw,
 * `result(out)` the members its `result` event carries; `identity` rides on
 * the admission and the result.
 */
export async function streamRun(res, { key, identity, start, failed, result }) {
  const hub = { events: [], listeners: new Set() };
  const admission = coalesceRun(
    key,
    () =>
      start((event) => {
        hub.events.push(event);
        for (const listener of hub.listeners) listener(event);
      }),
    hub,
  );
  const progress = admission.entry.metadata;
  res.writeHead(http.HTTP_STATUS_OK, {
    'Content-Type': PROGRESS_CONTENT_TYPE,
    'Cache-Control': 'no-store',
  });
  const send = (event) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  send({ event: 'admitted', coalesced: admission.joined, ...identity });
  for (const event of progress.events) send(event);
  progress.listeners.add(send);
  let out;
  try {
    out = await admission.entry.promise;
  } catch (error) {
    out = failed(error);
  } finally {
    progress.listeners.delete(send);
  }
  send({
    event: 'result',
    ...result(out),
    ...identity,
    coalesced: admission.joined,
  });
  res.end();
}
