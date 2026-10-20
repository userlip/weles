// What a POST /run request asks for: the action, how its output is answered
// (`creds`), its parameters with what the result file records of them, the
// account it acts on and whether that account gets a fresh browser profile.
// A malformed request is answered with its refusal, not run.

import { constants as http } from 'node:http2';
import { ALLOW_RAW_CREDS } from '../../configuration.mjs';

// `creds`: redact the run, return it verbatim (raw), or answer the account
// item the run saved to Skarbiec (store).
const CREDENTIAL_MODES = {
  redact: { raw: false, store: false },
  raw: { raw: true, store: false },
  store: { raw: false, store: true },
};

/** A refusal of the request: its status and answer. */
function refused(status, error) {
  return { refusal: { status, body: { ok: false, error } } };
}

/** A login role a request states, trimmed, beside the parameters the run gets. */
function loginRole(params) {
  return typeof params.login_role === 'string'
    ? { login_role: params.login_role.trim() }
    : {};
}

/**
 * The run `body` asks for, or `{ refusal }`. A request that names no `creds`
 * mode is redacted; one that names no params runs with none.
 */
export function readRunRequest(
  body,
  validateAccountSecurityParams,
  validateAppPasswordParams,
) {
  const action = typeof body.action === 'string' ? body.action.trim() : '';
  if (!action) return refused(http.HTTP_STATUS_BAD_REQUEST, 'missing_action');
  const credsMode =
    typeof body.creds === 'string' ? body.creds.trim() : 'redact';
  if (!Object.hasOwn(CREDENTIAL_MODES, credsMode))
    return refused(
      http.HTTP_STATUS_BAD_REQUEST,
      `creds is ${credsMode}; it must be one of ${Object.keys(CREDENTIAL_MODES).join(', ')}`,
    );
  const mode = CREDENTIAL_MODES[credsMode];
  if (mode.raw && !ALLOW_RAW_CREDS)
    return refused(http.HTTP_STATUS_FORBIDDEN, 'raw_creds_forbidden');
  let params =
    body.params && typeof body.params === 'object' ? body.params : {};
  let requestBinding = {};
  try {
    if (action === 'google_mfa_status') {
      const loginItem = validateAccountSecurityParams(params);
      requestBinding = {
        params: { login_item: loginItem, ...loginRole(params) },
      };
      params = { login_item: loginItem };
    }
    // An app-password run is read back by the login it signed in, so the
    // result file carries that login from the moment it is admitted.
    if (action === 'google_app_password') {
      const { loginItem, organization, expectedAccount } =
        validateAppPasswordParams(params);
      requestBinding = {
        params: {
          login_item: loginItem,
          organization,
          expected_account: expectedAccount,
          ...loginRole(params),
        },
      };
      params = {
        login_item: loginItem,
        organization,
        expected_account: expectedAccount,
      };
    }
  } catch (error) {
    return refused(http.HTTP_STATUS_BAD_REQUEST, error.message);
  }
  const accountId =
    typeof body.account_id === 'string' ? body.account_id : null;
  const freshProfile = body.fresh_profile === true;
  // A fresh profile with no account signs in as nobody.
  if (freshProfile && !accountId)
    return refused(
      http.HTTP_STATUS_BAD_REQUEST,
      'fresh_profile_requires_account_id',
    );
  return { action, mode, params, requestBinding, accountId, freshProfile };
}
