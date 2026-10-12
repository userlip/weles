// The operator request record: where it lives, how it is read and written,
// whether it is open or abandoned, and the answers and notes recorded on it.
// Opening a request and putting it to the operator is ./request.mjs.

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { homedir, hostname } from 'node:os';
import { isAbsolute, join } from 'node:path';

export const OPERATOR_REQUEST_SCHEMA = 'wisent.weles-operator-request.v1';

const DIRECTORY_VARIABLE = 'WELES_OPERATOR_REQUEST_DIR';

/** Where the requests live. One directory per host, overridable for tests. */
export function operatorRequestDir() {
  const configured = String(process.env[DIRECTORY_VARIABLE] || '').trim();
  const root =
    configured.length > 0
      ? configured
      : join(homedir(), '.weles', 'operator-requests');
  if (!isAbsolute(root)) {
    throw new Error(
      `${DIRECTORY_VARIABLE} must be an absolute path, got ${root}`,
    );
  }
  mkdirSync(root, { recursive: true });
  return root;
}

function requestFile(id) {
  if (!/^[0-9a-f-]{8,64}$/.test(String(id)))
    throw new Error(`invalid operator request id: ${id}`);
  return join(operatorRequestDir(), `${id}.json`);
}

export function required(value, field) {
  const text = String(value ?? '').trim();
  if (text.length === 0) throw new Error(`operator request needs ${field}`);
  return text;
}

/** One line, whole: a refusal is quoted as the channel said it. */
export function flatten(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function write(request) {
  writeFileSync(
    requestFile(request.id),
    `${JSON.stringify(request, null, 2)}\n`,
  );
  return request;
}

/**
 * What the operator can tell the run that waits on a request:
 * - `ready`: he has his phone in hand, so the run asks the provider to send
 *   its prompt now; a run sends none before, so no prompt expires unseen;
 * - `approved`: he approved it, so the run reads the page and records what
 *   the provider actually shows, instead of nobody learning the two disagree;
 * - `not_received`: no prompt reached him, or it expired, so the run asks the
 *   provider to send it again, or ends saying the provider offers no second send.
 * Ending the wait is ending the run: `weles runs cancel`.
 */
export const OPERATOR_ANSWERS = Object.freeze([
  'ready',
  'approved',
  'not_received',
]);

/**
 * Record the operator's answer on an open request. The run that waits on it
 * is watching the record (`nextOperatorAnswer`) and acts on it at once. A
 * closed request has no run waiting, so an answer to it is refused with how
 * it ended.
 */
export function answerOperatorRequest(id, answer, detail) {
  if (!OPERATOR_ANSWERS.includes(answer)) {
    throw new Error(
      `operator request answer must be one of ${OPERATOR_ANSWERS.join(', ')}; got ${answer}`,
    );
  }
  const request = readOperatorRequest(id);
  if (!isOpen(request)) {
    throw new Error(
      `operator request ${id} closed at ${request.closed_at} (${request.outcome_detail}); no run waits for an answer`,
    );
  }
  request.answers = [
    ...(Array.isArray(request.answers) ? request.answers : []),
    { at: new Date().toISOString(), answer, detail: flatten(detail) },
  ];
  return write(request);
}

/**
 * Record what the waiting run did about an answer, or saw on the page, so
 * the record says it and not only the run's log.
 */
export function noteOperatorRequest(id, note) {
  const request = readOperatorRequest(id);
  request.notes = [
    ...(Array.isArray(request.notes) ? request.notes : []),
    { at: new Date().toISOString(), note: flatten(required(note, 'a note')) },
  ];
  return write(request);
}

/**
 * The first answer recorded after the `seen` answers the caller has already
 * acted on. It watches the request's own file, so the wait ends when the
 * answer is written, not on a clock; `signal` stops watching.
 */
export function nextOperatorAnswer(id, seen, signal) {
  const file = requestFile(id);
  return new Promise((resolve, reject) => {
    let watcher = null;
    const finish = (settle, value) => {
      watcher?.close();
      signal?.removeEventListener('abort', aborted);
      settle(value);
    };
    const aborted = () => finish(resolve, null);
    const look = () => {
      let request;
      try {
        request = readOperatorRequest(id);
      } catch (error) {
        // A record being rewritten reads short for an instant; the write
        // that follows fires the watcher again.
        if (error instanceof SyntaxError) return;
        finish(reject, error);
        return;
      }
      const answers = Array.isArray(request.answers) ? request.answers : [];
      if (answers.length > seen) finish(resolve, answers[seen]);
    };
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    signal?.addEventListener('abort', aborted, { once: true });
    watcher = watch(file, look);
    look();
  });
}

export function readOperatorRequest(id) {
  const parsed = JSON.parse(readFileSync(requestFile(id), 'utf8'));
  if (parsed?.schema !== OPERATOR_REQUEST_SCHEMA) {
    throw new Error(
      `${requestFile(id)} is not a ${OPERATOR_REQUEST_SCHEMA} record`,
    );
  }
  return parsed;
}

export function isOpen(request) {
  return !request.closed_at;
}

/** Only the owning host can observe the waiting process. Missing process
 * identity or an unexpected OS error is unknown, not proof it exited. */
export function isAbandoned(request) {
  if (!isOpen(request)) return false;
  if (
    request.host !== hostname() ||
    !Number.isSafeInteger(request.run_pid) ||
    request.run_pid <= 0
  )
    return null;
  try {
    process.kill(request.run_pid, 0);
    return false;
  } catch (error) {
    if (error?.code === 'ESRCH') return true;
    if (error?.code === 'EPERM') return false;
    return null;
  }
}

/** The requests, newest first: every one, or the newest `limit` when the
 * caller names a count. `openOnly` answers the one question an operator asks
 * in a hurry: is anything waiting for me right now. */
export function listOperatorRequests(options) {
  const limit = Number(options?.limit);
  const openOnly = options?.openOnly === true;
  const dir = operatorRequestDir();
  const requests = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.json')) continue;
    try {
      requests.push(JSON.parse(readFileSync(join(dir, entry), 'utf8')));
    } catch {
      // A half-written record is not a reason to hide the rest.
    }
  }
  const selected = requests
    .filter((request) => request?.schema === OPERATOR_REQUEST_SCHEMA)
    .filter((request) => (openOnly ? isOpen(request) : true))
    .sort((left, right) =>
      String(right.opened_at).localeCompare(String(left.opened_at)),
    );
  return Number.isFinite(limit) && limit > 0
    ? selected.slice(0, Math.round(limit))
    : selected;
}
