// The answer to a run the request waited for. A credential run in store mode
// answers the account items it saved to Skarbiec; in redact mode only whether
// it produced a credential and, when it failed, its declared failure; raw mode
// answers the run verbatim, and every other run is answered redacted.

import { constants as http } from 'node:http2';
import { json } from '../../http-exchange.mjs';
import {
  credentialFailure,
  isCredentialTrajectory,
  savedAccounts,
} from '../../run/credential-outcome.mjs';

export function answerRun(res, { action, mode, out, joined }) {
  if (out.error === 'no_trajectory') {
    json(res, http.HTTP_STATUS_NOT_FOUND, out);
    return;
  }
  const status = out.ok ? http.HTTP_STATUS_OK : http.HTTP_STATUS_BAD_GATEWAY;
  if (mode.store) {
    if (!out.ok) {
      json(res, http.HTTP_STATUS_BAD_GATEWAY, {
        ok: false,
        exitCode: out.exitCode,
        action,
        run_id: out.run_id,
        error: 'run_failed',
        stderr_tail: out.stderr_tail,
      });
      return;
    }
    const accounts = savedAccounts(out.run_id);
    if (!accounts.length) {
      json(res, http.HTTP_STATUS_UNPROCESSABLE_ENTITY, {
        ok: false,
        action,
        run_id: out.run_id,
        error: 'no_account_saved',
      });
      return;
    }
    json(res, http.HTTP_STATUS_OK, {
      ok: true,
      action,
      run_id: out.run_id,
      accounts,
      coalesced: joined,
    });
    return;
  }
  // Raw output and arbitrary failure text of a credential run stay inside
  // Weles; its answer is whether it produced a credential and its declared
  // failure.
  if (isCredentialTrajectory(action) && !mode.raw) {
    const result = { credential_produced: out.ok && out.result !== null };
    if (!out.ok) result.failure = credentialFailure(out);
    json(res, status, {
      ok: out.ok,
      exitCode: out.exitCode,
      action,
      run_id: out.run_id,
      result,
      coalesced: joined,
    });
    return;
  }
  json(res, status, { ...out, coalesced: joined }, { redact: !mode.raw });
}
