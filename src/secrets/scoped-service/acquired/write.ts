// Writing a credential a browser job acquired to the one Skarbiec item its
// acquisition contract names, through the scoped write helper, or into the
// owner-only WELES_CREDENTIALS_FILE on a machine without Skarbiec.

import { isUtf8 } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { isRequestId } from '../../request-id.js';
import {
  isWelesAcquiredSourceOrigin,
  resolvedAcquiredSecretContract,
  type WelesAcquiredSecret,
} from '../contracts.js';
import { localCredentialsFile, writeLocalFields } from '../local-file.js';
import {
  checkedTokenFile,
  deployedFile,
  skarbiecEndpoint,
} from '../transport.js';
import { isWelesAcquiredSecretValue } from './value.js';

/**
 * The operations a credential write may commit for, each with whether it
 * only makes sense for a password contract: a reset commits a value whose
 * predecessor was never known to us, an adopt one the operator already knew,
 * and a rollback restores one.
 */
const WRITE_OPERATIONS: Readonly<Record<string, { passwordOnly: boolean }>> = {
  acquire: { passwordOnly: false },
  rotate: { passwordOnly: false },
  verify: { passwordOnly: false },
  adopt: { passwordOnly: true },
  reset: { passwordOnly: true },
  rollback: { passwordOnly: true },
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function writeWelesAcquiredSecret(
  secretName: WelesAcquiredSecret,
  field: string,
  secret: Buffer,
  tenantId?: string | null,
  context: {
    accountEmail?: string;
    requestId?: string;
    operation?: string;
    sourceOrigin?: string;
    declaredOrigin?: string;
  } = {},
): void {
  const contract = resolvedAcquiredSecretContract(secretName);
  if (!contract || field !== contract.field) {
    throw new Error(
      `secret target is not in the exact Weles acquisition contract: ${secretName}/${field}`,
    );
  }
  if (!isWelesAcquiredSecretValue(secretName, secret)) {
    throw new Error(
      `acquired value does not match the exact Weles acquisition contract: ${secretName}/${field}`,
    );
  }
  const local = localCredentialsFile();
  const requestId = context.requestId;
  if (!isRequestId(requestId)) {
    throw new Error(
      `credential write for ${secretName} needs the operation's request id (a SHA-256 digest in hexadecimal); it was given ${JSON.stringify(requestId)}`,
    );
  }
  const operation = context.operation;
  if (!operation || !Object.hasOwn(WRITE_OPERATIONS, operation)) {
    throw new Error(
      `credential write for ${secretName} names operation ${JSON.stringify(operation)}; a write is one of ${Object.keys(WRITE_OPERATIONS).join(', ')}`,
    );
  }
  if (
    WRITE_OPERATIONS[operation].passwordOnly &&
    contract.shape !== 'password'
  ) {
    throw new Error(
      `${operation} writes are only allowed for password contracts: ${secretName}`,
    );
  }
  if (!isUtf8(secret)) {
    throw new Error(`credential value must be valid UTF-8 text: ${secretName}`);
  }
  // The provenance this write claims is the origin the value was captured on. A
  // table contract pins it; a derived contract has none to pin, so the caller
  // must state the captured origin and it must be one absolute https origin —
  // Skarbiec matches it against the signup origin recorded for the operation.
  const capturedOrigin = contract.sourceOrigin ?? context.sourceOrigin;
  if (!capturedOrigin || !isWelesAcquiredSourceOrigin(capturedOrigin)) {
    throw new Error(
      `credential write requires one exact captured https origin for ${secretName}`,
    );
  }
  // Skarbiec records the signup origin a generic acquire declared and refuses the
  // managed write unless the body echoes exactly that string; it equally refuses a
  // capture origin presented for an operation that declared none, so the key
  // travels only when one was declared and only as the exact recorded value.
  const declaredOrigin = context.declaredOrigin;
  if (declaredOrigin && declaredOrigin !== capturedOrigin) {
    throw new Error(
      `captured origin does not match the declared signup origin for ${secretName}`,
    );
  }
  const accountEmail = context.accountEmail?.trim().toLowerCase();
  const value = secret.toString('utf8');
  let kind: string;
  let fields: Record<string, string>;
  if (contract.shape === 'password') {
    if (!accountEmail || !EMAIL.test(accountEmail)) {
      throw new Error(
        `Microsoft password write requires one valid account email for ${secretName}`,
      );
    }
    kind = 'login';
    fields = { username: accountEmail, password: value };
  } else {
    kind = 'api-key';
    fields = { api_key: value };
  }
  if (local) {
    writeLocalFields(local, contract.item, fields, tenantId);
    return;
  }
  const tokenFile = checkedTokenFile(contract.writerTokenFile, tenantId);
  if (tokenFile === null)
    throw new Error(
      `required scoped Skarbiec writer token is unavailable for ${secretName}`,
    );
  const input = Buffer.from(
    JSON.stringify({
      schema: 'skarbiec.item.v2',
      kind,
      fields,
      context: {
        provider: capturedOrigin,
        account_ref: accountEmail || requestId,
        request_id: requestId,
        operation,
      },
      ...(declaredOrigin ? { capture_origin: declaredOrigin } : {}),
    }),
    'utf8',
  );
  try {
    const helper =
      process.env.SKARBIEC_WELES_WRITER_COMMAND?.trim() ||
      deployedFile('skarbiec-write.mjs');
    const result = spawnSync(
      process.execPath,
      [
        helper,
        contract.writerConsumer,
        contract.item,
        contract.field,
        tokenFile,
        operation,
        requestId,
      ],
      {
        input,
        maxBuffer: Infinity,
        stdio: ['pipe', 'ignore', 'pipe'],
        env: {
          HOME: homedir(),
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          WC_SKARBIEC_URL: skarbiecEndpoint(tenantId),
        },
      },
    );
    if (result.error || result.status || result.signal) {
      // The helper's own words are the cause: they are passed on whole, with
      // the credential itself redacted wherever it appears.
      const exited = result.error
        ? `could not run: ${result.error.message}`
        : result.signal
          ? `was ended by signal ${result.signal}`
          : `exited with status ${result.status}`;
      const said = Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8').split(value).join('[redacted]').trim()
        : '';
      throw new Error(
        `scoped Skarbiec write failed for ${secretName}/${field} via ${skarbiecEndpoint(tenantId)}: the write helper ${exited}${said ? `: ${said}` : ' and wrote nothing to stderr'}`,
      );
    }
  } finally {
    input.fill('\0');
  }
}
