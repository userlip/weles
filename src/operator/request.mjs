// Asking the operator for the one action a run cannot perform itself.
//
// Some flows stop on a person: Google answers a first sign-in from a fresh
// profile with a push to the account owner's phone, and no amount of
// automation taps it. Until now that waiting was invisible — the operator was
// never told that anything wanted him or which account it was. The agent
// running the flow filled that gap by hand, in chat, which is not a product.
//
// This module is the product: a run opens a request naming what has to be
// done, the request is put to the operator as one Oko ask on the channels he
// chose (`oko contact`), or paged through Stado's alert channels on a host
// without Oko; it lives as a file the worker reads, and it is closed with
// whether the
// person acted and how long the run waited. A request belongs to the runs
// that wait on it: `weles runs list|show` show what a run waits for, and
// `weles runs answer` is how the operator answers it.
//
// A request has two facts and no vocabulary: it is open until `closed_at` is
// written, and when it closes, `approved` says whether the person did the
// thing. A request carries the process id of the run that waits on it: the
// request stays open as long as that run is alive, and an open request whose
// run has exited without closing it reads as abandoned. No clock decides
// either.

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { askThroughOko, relayOkoAnswer, withdrawOkoAsk } from './oko-ask.mjs';
import { page } from './page.mjs';
import {
  flatten,
  isAbandoned,
  isOpen,
  listOperatorRequests,
  OPERATOR_REQUEST_SCHEMA,
  readOperatorRequest,
  required,
  write,
} from './record.mjs';

export { pageBody, pageSubject } from './page.mjs';
export {
  answerOperatorRequest,
  isAbandoned,
  isOpen,
  listOperatorRequests,
  nextOperatorAnswer,
  noteOperatorRequest,
  OPERATOR_ANSWERS,
  OPERATOR_REQUEST_SCHEMA,
  operatorRequestDir,
  readOperatorRequest,
} from './record.mjs';

const MILLISECONDS_PER_SECOND = 1000; // https://www.bipm.org/en/measurement-units/si-prefixes milli = 10^-3

/**
 * Set by the API server on every run it spawns; the run's stderr is the
 * progress channel its caller reads (`STEP`, `AUTH_FAILURE`, and this).
 */
const RUN_ID_VARIABLE = 'ACTION_LOG_ID';
const PROGRESS_WORD = 'OPERATOR_REQUEST';

/**
 * Tell whoever ordered this run that it now waits for a person. Nothing on the
 * page changes until the person acts, so without this line the caller waits in
 * silence and cannot say what it waits for. Only a run the API server spawned
 * has a caller reading its stderr.
 */
function announce(request) {
  if (!currentRunId()) return;
  process.stderr.write(
    `${PROGRESS_WORD} ${JSON.stringify({
      id: request.id,
      kind: request.kind,
      account: request.account,
      instruction: request.instruction,
      host: request.host,
      opened_at: request.opened_at,
      paged: request.pages.some((attempt) => attempt.ok),
    })}\n`,
  );
}

/**
 * The request already waiting on this person for the same thing, if any.
 *
 * Two runs that hit the same wall — every account in a pool failing the same
 * sign-in, say — would otherwise page the operator once each for one action.
 * A request is the same when it asks the same kind of thing about the same
 * account and nobody has closed it.
 */
export function openRequestFor(kind, account) {
  const wanted = String(kind).trim();
  const who = String(account).trim();
  return listOperatorRequests({ openOnly: true }).find(
    (request) => request.kind === wanted && request.account === who,
  );
}

/** The Weles run this process is, when a worker started it. */
function currentRunId() {
  const named = process.env[RUN_ID_VARIABLE];
  const runId = typeof named === 'string' ? named.trim() : '';
  return runId === '' ? null : runId;
}

/**
 * Open a request and tell the operator about it.
 *
 * The caller keeps waiting for its own condition; this records the wait and
 * makes it visible. `closeOperatorRequest` is what says how it ended. An
 * identical request already waiting is returned with this run added to the
 * runs waiting on it: the person is asked once, not once per run that needs
 * the same hand, and every one of those runs can be answered. The waiting
 * process is the caller's own.
 */
export function openOperatorRequest(input) {
  const runId = currentRunId();
  const waiting = openRequestFor(input.kind, input.account);
  if (waiting && isAbandoned(waiting) === false) {
    const runIds = Array.isArray(waiting.run_ids) ? waiting.run_ids : [];
    const joined =
      runId && !runIds.includes(runId)
        ? write({ ...waiting, run_ids: [...runIds, runId] })
        : waiting;
    announce(joined);
    return joined;
  }
  const opened = new Date();
  const request = {
    schema: OPERATOR_REQUEST_SCHEMA,
    id: randomUUID(),
    kind: required(input.kind, 'a kind'),
    account: required(input.account, 'an account'),
    instruction: required(input.instruction, 'an instruction for the operator'),
    run: required(input.run, 'the run that is waiting'),
    run_ids: runId ? [runId] : [],
    run_pid: process.pid,
    host: hostname(),
    opened_at: opened.toISOString(),
    closed_at: null,
    approved: null,
    waited_seconds: null,
    outcome_detail: '',
    pages: [],
    answers: [],
  };
  write(request);
  const asked = askThroughOko(request);
  request.pages.push(asked);
  if (asked.oko_missing) request.pages.push(page(request));
  const written = write(request);
  if (asked.ok && asked.ask_id) relayOkoAnswer(written.id, asked.ask_id);
  announce(written);
  return written;
}

/** The open request a Weles run waits on, or null when it waits on nobody. */
export function openRequestOfRun(runId) {
  const waitedOn = listOperatorRequests({ openOnly: true }).find(
    (request) =>
      Array.isArray(request.run_ids) && request.run_ids.includes(runId),
  );
  return waitedOn === undefined ? null : waitedOn;
}

/**
 * Close a request: did the person do it, and what does the run say about it.
 */
export function closeOperatorRequest(id, approved, detail) {
  if (typeof approved !== 'boolean') {
    throw new Error(
      `operator request closes with approved true or false; got ${approved}`,
    );
  }
  const request = readOperatorRequest(id);
  const closed = new Date();
  request.approved = approved;
  request.closed_at = closed.toISOString();
  // The wait as the two clock readings measure it; a clock set back between
  // them shows as a negative wait rather than being rounded up to none.
  request.waited_seconds = Math.round(
    (closed.getTime() - new Date(request.opened_at).getTime()) /
      MILLISECONDS_PER_SECOND,
  );
  request.outcome_detail = flatten(
    required(detail, 'a sentence saying how the wait ended'),
  );
  withdrawOkoAsk(request);
  return write(request);
}

/**
 * Ask the operator again on an open request, through the channels he chose,
 * because what he was asked for changed: `why` says what changed (Google's
 * prompt expired, say) and is kept as a note beside the new page attempt, so
 * the record shows each time he was asked and why.
 */
export function repageOperatorRequest(id, why) {
  const request = readOperatorRequest(id);
  if (!isOpen(request)) {
    throw new Error(
      `operator request ${id} closed at ${request.closed_at}; it cannot be asked again`,
    );
  }
  const reason = flatten(required(why, 'why the operator is asked again'));
  const asked = { ...request, instruction: `${request.instruction} ${reason}` };
  request.notes = [
    ...(Array.isArray(request.notes) ? request.notes : []),
    { at: new Date().toISOString(), note: reason },
  ];
  request.pages = [...request.pages, page(asked)];
  return write(request);
}
