// The routes that order one named trajectory rather than one the caller
// names itself.
//
// POST /run takes an action and its parameters and is elsewhere. These each
// decide the action on the caller's behalf, and each has its own idea of
// who may ask. /imports does not run anything at all: it validates a trajectory
// document and persists it against a host, so a draft becomes an action /run
// can later name. /reauth is admitted by Brama's own token and never by the
// general API token, because it spends a real browser sign-in on exactly one
// vault row and the broker -- not the operator -- decides which.
// /reauth/enrol-authenticator (trajectory/authenticator-enrolment.mjs) is
// admitted the same way, through the same account admission
// (trajectory/reauth-account.mjs). /weles-builder (trajectory/builder.mjs)
// takes prose instead of parameters and its answer is a new reusable
// trajectory.
//
// They share one refusal: a request that names an account it is not entitled
// to, or a provider Weles does not run on the host, is answered before any
// child is spawned.

import { constants as http } from 'node:http2';
import { json, readBody, requireTokenAuthorization } from '../http-exchange.mjs';
import { coalesceRun, runAdmissionKey } from '../run/run-outcome.mjs';
import { runReauth } from '../run/process/reauth-process.mjs';
import { admittedReauthAccount } from './trajectory/reauth-account.mjs';
import { answerRefusal } from './trajectory/refusal.mjs';

/** The message of a failure, whatever was thrown. */
function failure(error) {
  return error instanceof Error ? error.message : String(error);
}

export async function respondToDocumentImport(
  req,
  res,
  importWelesTrajectoryDocument,
) {
  if (!requireTokenAuthorization(req, res)) return;
  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    json(res, http.HTTP_STATUS_BAD_REQUEST, { ok: false, error: failure(error) });
    return;
  }
  let report;
  try {
    report = await importWelesTrajectoryDocument(body.source, body.target_host);
  } catch (error) {
    json(res, http.HTTP_STATUS_BAD_REQUEST, { ok: false, error: failure(error) });
    return;
  }
  // A report that imported any document created it; one that imported
  // none answers what it found unchanged or refused.
  json(
    res,
    report.imported ? http.HTTP_STATUS_CREATED : http.HTTP_STATUS_OK,
    report,
  );
}

/** One JSON object per line; the last line is the `result` event. */
export const REAUTH_PROGRESS_CONTENT_TYPE = 'application/x-ndjson';

// Resolve a Skarbiec subscription first; /reauth/resolve never starts a browser.
export async function respondToReauth(
  req,
  res,
  selectLoginAccount,
  resolveOnly,
) {
  let admitted;
  try {
    admitted = await admittedReauthAccount(
      req,
      selectLoginAccount,
      'authentication',
    );
  } catch (error) {
    answerRefusal(res, error);
    return;
  }
  const { account, identity, provider } = admitted;
  if (resolveOnly) {
    json(res, http.HTTP_STATUS_OK, { ok: true, source: 'skarbiec', ...identity });
    return;
  }
  // An admitted sign-in answers as it goes, one JSON object per line: what
  // the run is doing now (`started`, every `stage`, an `operator_request` when
  // it waits for a person) and, last, `result`. A browser sign-in has no clock
  // that ends it, so a caller that only got the verdict could only wait in
  // silence and could not say what it was waiting for. A caller that joins a
  // run already under way is first sent everything that run has reported.
  const hub = { events: [], listeners: new Set() };
  const admission = coalesceRun(
    runAdmissionKey('reauth', {
      provider,
      login_item: account.loginItem,
      subscription_id: account.subscriptionId,
      account_revision: account.accountRevision,
    }),
    () =>
      runReauth(provider, account, (event) => {
        hub.events.push(event);
        for (const listener of hub.listeners) listener(event);
      }),
    hub,
  );
  const progress = admission.entry.metadata;
  res.writeHead(http.HTTP_STATUS_OK, {
    'Content-Type': REAUTH_PROGRESS_CONTENT_TYPE,
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
    out = { ok: false, error: 'reauth_run_failed', message: failure(error) };
  } finally {
    progress.listeners.delete(send);
  }
  send({
    event: 'result',
    ...out,
    ...identity,
    refreshed: out.ok,
    coalesced: admission.joined,
  });
  res.end();
}
