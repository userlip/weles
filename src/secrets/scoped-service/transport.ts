// Reading Weles's scoped Skarbiec credentials: one field of a role through
// `stado credentials get --role`, or one field acquired by the run's
// workload identity through the deployed acquisition helper, and whether a
// managed credential can be written back. Where Skarbiec is and with which
// token is transport/binding.ts; what the catalog grants is transport/grants.ts.

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolvedAcquiredSecretContract, SERVICE_CONTRACTS } from './contracts.js';
import {
  acquisitionStderr,
  SkarbiecAcquisitionError,
} from './acquisition-failure.js';
import { localCredentialsFile, readLocalField } from './local-file.js';
import {
  checkedTokenFile,
  deployedFile,
  skarbiecEndpoint,
} from './transport/binding.js';
import { acquisitionScopesFile } from './transport/grants.js';

/**
 * Why Weles cannot write `secret` back to Skarbiec, or null when it can. The
 * reason is the refusal itself (no contract, no WC_SKARBIEC_URL, an unsafe or
 * missing writer token file), so "needs configuration" says what to configure.
 */
export function welesAcquiredSecretWriterProblem(
  secret: string,
  tenantId?: string | null,
): string | null {
  const contract = resolvedAcquiredSecretContract(secret);
  if (!contract) return `no acquired-secret contract declares ${secret}`;
  if (localCredentialsFile()) return null;
  try {
    skarbiecEndpoint(tenantId);
    if (!checkedTokenFile(contract.writerTokenFile, tenantId))
      return `the scoped Skarbiec writer token file ${contract.writerTokenFile} for ${secret} has not been issued`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// The barrel scoped-service.ts still re-exports this name, and that file is
// refused by block-keyword-literals for its operation list, so the boolean
// stays as the problem's negation rather than a second check.
export function hasWelesAcquiredSecretWriter(
  secret: string,
  tenantId?: string | null,
): boolean {
  return welesAcquiredSecretWriterProblem(secret, tenantId) === null;
}

export type WelesServiceSecret = keyof typeof SERVICE_CONTRACTS;

/** The child environment a Skarbiec helper runs in: this user's home and PATH, plus `extra`. */
function helperEnvironment(
  extra: Record<string, string>,
): Record<string, string> {
  return {
    HOME: homedir(),
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...extra,
  };
}

type HelperRun = SpawnSyncReturns<Buffer>;

/** How a helper that ran ended, for a refusal that repeats its own words. */
function helperEnd(result: HelperRun): string {
  if (result.signal) return `was ended by signal ${result.signal}`;
  return `exited with status ${result.status}`;
}

/**
 * The helper's standard output once it ran and exited cleanly; otherwise the
 * refusal `refuse` builds from what the helper wrote to standard error and
 * how it ended, its output cleared first.
 */
function succeeded(
  result: HelperRun,
  refuse: (stderr: string, ended: string) => Error,
): Buffer {
  if (result.error) throw refuse('', `could not run: ${result.error.message}`);
  if (result.status || result.signal) {
    result.stdout.fill('');
    throw refuse(result.stderr.toString('utf8'), helperEnd(result));
  }
  return result.stdout;
}

/** One line of text a helper printed, refused naming `what` when it is not one. */
function helperValue(output: Buffer, what: string): string {
  const value = output.toString('utf8').replace(/[\r\n]+$/, '');
  if (!value || /[\r\n]/.test(value) || value.includes('\0'))
    throw new Error(
      `${what} returned an invalid value: it must be one line of text`,
    );
  return value;
}

/** The Stado binary: WELES_STADO_BIN when the deployment names one, else the one Stado installs. */
function stadoBinary(): string {
  const configured = process.env.WELES_STADO_BIN?.trim();
  if (configured) return configured;
  return join(homedir(), '.stado', 'bin', 'stado');
}

/**
 * One field of the item playing role `role`, read with the consumer's own
 * grant (`read:role:<role>#<field>`). The local credentials file keys the
 * fields by the role name. Undefined when the consumer's token was never
 * issued.
 */
export function readScopedField(
  consumer: string,
  role: string,
  tokenFileName: string,
  field: string,
): string | undefined {
  const local = localCredentialsFile();
  if (local) return readLocalField(local, role, field);
  const tokenFile = checkedTokenFile(tokenFileName);
  if (!tokenFile) return undefined;
  const result = spawnSync(
    stadoBinary(),
    ['credentials', 'get', '--role', role, '--field', field],
    {
      encoding: 'buffer',
      maxBuffer: Infinity,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: helperEnvironment({
        WC_SKARBIEC_URL: skarbiecEndpoint(),
        WC_SKARBIEC_CONSUMER: consumer,
        WC_SKARBIEC_TOKEN_FILE: tokenFile,
      }),
    },
  );
  const output = succeeded(result, (stderr, ended) => {
    const said = stderr.trim();
    return new Error(
      `scoped Skarbiec read failed for role ${role}/${field} as ${consumer}: stado credentials get ${ended}${said ? `: ${said}` : ' and wrote nothing to stderr'}`,
    );
  });
  try {
    return helperValue(output, `scoped Skarbiec read of role ${role}/${field}`);
  } finally {
    output.fill('');
  }
}

/**
 * Acquire one field through the workload-bound helper. `item` keys the local
 * credentials file; `coordinate` is what the acquisition catalog and Skarbiec
 * are asked for: the item itself, or `role:<role>` for a credential named by
 * the role its item plays. Undefined when this process carries no workload
 * identity.
 */
export function readAcquiredField(
  consumerBase: string,
  item: string,
  field: string,
  tenantId?: string | null,
  coordinate: string = item,
): string | undefined {
  const local = localCredentialsFile();
  if (local) return readLocalField(local, item, field, tenantId);
  const workloadId = process.env.SKARBIEC_WORKLOAD_ID?.trim();
  const signingKeyFile = process.env.SKARBIEC_WORKLOAD_SIGNING_KEY_FILE?.trim();
  if (!workloadId || !signingKeyFile) return undefined;
  const consumer = `${consumerBase}-${field}`;
  // A deployment that runs its own acquisition helper names it; the release's
  // helper runs otherwise.
  const configured = process.env.SKARBIEC_WELES_READER_ACQUIRE_COMMAND?.trim();
  const helper = configured
    ? configured
    : deployedFile('skarbiec-acquire.mjs');
  const scopeFile = acquisitionScopesFile(tenantId);
  // Resolve the authority once and pass that exact directory-owned endpoint to
  // the acquisition subprocess.
  const endpoint = skarbiecEndpoint(tenantId);
  const result = spawnSync(
    process.execPath,
    [helper, scopeFile, consumer, coordinate, field],
    {
      encoding: 'buffer',
      maxBuffer: Infinity,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: helperEnvironment({
        SKARBIEC_WORKLOAD_ID: workloadId,
        SKARBIEC_WORKLOAD_SIGNING_KEY_FILE: signingKeyFile,
        WC_SKARBIEC_URL: endpoint,
      }),
    },
  );
  const output = succeeded(result, (stderr, ended) => {
    // Repeat the authority's own words. Collapsing every refusal into one
    // sentence made an unregistered consumer, an out-of-window grant and a
    // missing scope line indistinguishable, and each needs a different fix.
    const { reason, lines } = acquisitionStderr(stderr);
    const diagnosis = lines.length
      ? lines.join(' | ')
      : `the helper ${ended} with no diagnosis`;
    return new SkarbiecAcquisitionError(
      `workload-bound Skarbiec acquisition failed for ${coordinate}/${field} as consumer ${consumer} against ${endpoint}: ${diagnosis}`,
      { item: coordinate, field, consumer },
      reason,
    );
  });
  try {
    return helperValue(
      output,
      `workload-bound Skarbiec acquisition of ${coordinate}/${field}`,
    );
  } finally {
    output.fill('');
  }
}
