// Paging the operator about a request through every alert channel Stado
// has: the page's subject and body, and the record of what the attempt did.
// A host with Oko asks through ./oko-ask.mjs instead.

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { stadoBinary } from '../_shared/skarbiec-runtime.mjs';
import { flatten } from './record.mjs';

export const PAGING_VARIABLE = 'WELES_OPERATOR_REQUEST_PAGING';
export const PAGING_DISABLED_VALUE = 'off';
const PAGE_CHANNEL = 'stado-alerts';
/** The word `stado alerts send` prints for a channel the provider accepted. */
const DELIVERED_WORD = 'delivered';

/** Whether this deployment may page. Off is a choice a test or a rerun makes;
 * it is recorded, so a request nobody was told about never looks delivered. */
export function pagingEnabled() {
  return (
    String(process.env[PAGING_VARIABLE] || '')
      .trim()
      .toLowerCase() !== PAGING_DISABLED_VALUE
  );
}

/** What the operator actually reads. Every line answers one question he would
 * otherwise have to ask: what, for which account, where, who is waiting, and
 * how to answer. A run the worker did not start has no run id, so nothing can
 * answer it but the page it waits on. */
export function pageBody(request) {
  const runIds = Array.isArray(request.run_ids) ? request.run_ids : [];
  return [
    'Weles is waiting for one action from you.',
    '',
    `What to do:  ${request.instruction}`,
    `Account:     ${request.account}`,
    `Host:        ${request.host}`,
    `Run:         ${request.run} (${runIds.length ? `Weles run ${runIds.join(', ')}` : `process ${request.run_pid}; not started by a Weles worker`})`,
    '',
    ...(runIds.length
      ? [
          `Watch it:    weles runs show ${runIds[0]}`,
          `Answer it:   weles runs answer ${runIds[0]} --ready | --approved | --not-received`,
        ]
      : []),
    'The run waits until you act or it is cancelled; if it ends first, this request is recorded as abandoned.',
  ].join('\n');
}

export function pageSubject(request) {
  return `Weles waits for you: ${request.kind} (${request.account})`;
}

/** Page every alert channel Stado has, and record what the attempt did.
 * Paging is best effort by construction: a run that cannot reach the pager
 * still waits, because the operator may be looking at the screen — but the
 * record says nobody was told, which is the difference between a silent
 * wait and a diagnosed one. */
export function page(request) {
  const at = new Date().toISOString();
  if (!pagingEnabled()) {
    return {
      at,
      ok: false,
      channel: PAGE_CHANNEL,
      detail: `paging disabled by ${PAGING_VARIABLE}=${PAGING_DISABLED_VALUE}`,
    };
  }
  let binary;
  try {
    binary = stadoBinary();
  } catch (error) {
    return {
      at,
      ok: false,
      channel: PAGE_CHANNEL,
      detail: flatten(`Stado pager unavailable: ${error?.message || error}`),
    };
  }
  const result = spawnSync(
    binary,
    ['alerts', 'send', pageBody(request), '--subject', pageSubject(request)],
    {
      encoding: 'utf8',
      env: { ...process.env, HOME: homedir() },
    },
  );
  if (result.error || result.status !== 0) {
    const detail =
      result.error?.message ||
      result.stderr ||
      result.stdout ||
      `exit ${result.status}`;
    return {
      at,
      ok: false,
      channel: PAGE_CHANNEL,
      detail: flatten(`stado alerts send refused: ${detail}`),
    };
  }
  // Stado names each channel and what it did: `resend\tdelivered\t<address>`.
  // A pager that exits zero saying nothing is not evidence that anyone was
  // reached — older Stado releases exited zero even when every provider
  // refused — so the record says exactly that instead of claiming delivery.
  const named = String(result.stdout || '')
    .split('\n')
    .filter((line) => line.includes(`\t${DELIVERED_WORD}\t`));
  if (named.length === 0) {
    return {
      at,
      ok: false,
      channel: PAGE_CHANNEL,
      detail:
        'stado alerts send exited successfully without naming a channel that took the message',
    };
  }
  return {
    at,
    ok: true,
    channel: PAGE_CHANNEL,
    detail: flatten(named.join('; ')),
  };
}
