import {
  operatorJson,
  welesOperatorConnection,
  type WelesApiOptions,
} from './connection.js';

export type AccountSecurityResult = {
  schema: 'weles.account-security.v1';
  ok: boolean;
  provider: 'google';
  login_item: string;
  account: string | null;
  two_factor_enabled: boolean | null;
  checked_at: string;
  reason: string | null;
  status_evidence?: string;
  account_evidence?: string;
  url?: string;
  error?: string;
  operation?: string;
  source_revision: string;
};

export type AccountSecurityRun = {
  id: string;
  action: 'google_mfa_status';
  status: string;
  completed_at: string | null;
  params: { login_role?: string; login_item?: string };
  result: AccountSecurityResult | null;
  error: string | null;
};

function parseRun(value: unknown): AccountSecurityRun {
  const row = value as Partial<AccountSecurityRun> | null;
  if (
    !row ||
    typeof row !== 'object' ||
    row.action !== 'google_mfa_status' ||
    typeof row.id !== 'string' ||
    typeof row.status !== 'string' ||
    (typeof row.params?.login_role !== 'string' &&
      typeof row.params?.login_item !== 'string')
  ) {
    throw new Error(
      `Weles returned an unrelated account-security run: ${JSON.stringify(row)}; the executor must return the run identifier, google_mfa_status action and requested login binding`,
    );
  }
  if (row.result !== null && row.result !== undefined) {
    const result = row.result;
    if (
      result.schema !== 'weles.account-security.v1' ||
      result.provider !== 'google' ||
      typeof result.login_item !== 'string' ||
      (row.params?.login_item !== undefined &&
        result.login_item !== row.params.login_item) ||
      typeof result.source_revision !== 'string' ||
      (result.account !== null && typeof result.account !== 'string') ||
      typeof result.ok !== 'boolean' ||
      (result.two_factor_enabled !== null &&
        typeof result.two_factor_enabled !== 'boolean') ||
      result.ok !== (typeof result.two_factor_enabled === 'boolean') ||
      typeof result.checked_at !== 'string'
    )
      throw new Error('Weles returned an invalid 2FA observation');
  }
  return {
    ...row,
    result: row.result === undefined ? null : row.result,
  } as AccountSecurityRun;
}

/** A recorded value, or null when the run file does not record it. */
function recorded<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}

/**
 * Why the run failed, as Weles recorded it: its error, else the run's stderr
 * tail; a failed run that recorded neither is reported with what it did
 * record. A run that did not fail has none.
 */
function runFailure(body: Record<string, unknown>): string | null {
  if (typeof body.error === 'string') return body.error;
  if (body.ok !== false) return null;
  if (typeof body.stderr_tail === 'string') return body.stderr_tail;
  return `the run failed and recorded neither an error nor stderr: ${JSON.stringify(body)}`;
}

export async function accountSecurityRun(
  input: { loginRole: string } | { runId: string },
  options: WelesApiOptions = {},
): Promise<AccountSecurityRun> {
  const creating = 'loginRole' in input;
  const value = (creating ? input.loginRole : input.runId).trim();
  if (!value)
    throw new Error(creating ? 'login_role_required' : 'run_id_required');
  const path = creating
    ? '/run'
    : `/diagnostics/${encodeURIComponent(value)}/file?path=run-result.json`;
  const connection = welesOperatorConnection(path, options);
  const operation = creating
    ? 'submit_account_security'
    : 'read_account_security_result';
  try {
    const response = await connection.fetch(connection.endpoint, {
      method: creating ? 'POST' : 'GET',
      headers: connection.headers,
      redirect: 'error',
      ...(creating
        ? {
            body: JSON.stringify({
              action: 'google_mfa_status',
              params: { login_role: value },
              detached: true,
            }),
          }
        : {}),
    });
    const body = await operatorJson(response);
    if (!response.ok)
      throw new Error(
        `HTTP ${response.status}: ${typeof body.error === 'string' ? body.error : JSON.stringify(body)}`,
      );
    if (creating && body.ok !== true)
      throw new Error(
        `Weles did not accept the account-security request: ${JSON.stringify(body)}`,
      );
    const row = parseRun(
      creating
        ? {
            id: body.detached_run,
            action: body.action,
            params: body.params,
            status: 'running',
            completed_at: null,
            result: null,
            error: null,
          }
        : {
            id: value,
            action: body.action,
            params: body.params,
            status: body.status,
            completed_at: recorded(body.completed_at),
            result: recorded(body.result),
            error: runFailure(body),
          },
    );
    if (creating ? row.params.login_role !== value : row.id !== value) {
      throw new Error(
        `Weles returned a different account-security request: ${JSON.stringify({
          requested: creating ? { login_role: value } : { id: value },
          observed: {
            id: row.id,
            login_role: row.params.login_role,
            login_item: row.params.login_item,
          },
        })}`,
      );
    }
    return row;
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    const detail =
      cause instanceof Error && cause.cause ? `: ${String(cause.cause)}` : '';
    throw new Error(`${operation} ${connection.endpoint}: ${error}${detail}`, {
      cause,
    });
  }
}
