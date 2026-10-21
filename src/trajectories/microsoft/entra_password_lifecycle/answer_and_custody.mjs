// What an Entra password run hands back to the operator, and how the password
// material itself is held: one shape for every terminal answer, the approval and
// receipt resources it carries, and the read, write and clearing of the secret.
//
// Moved out of entra_password_lifecycle.mjs, which keeps the three trajectory
// entry points.

import { createHash, randomFillSync, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';

import {
  readWelesManagedCredential,
  writeWelesAcquiredSecret,
} from '../../../../dist/secrets/scoped-service.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { writeCredentialOperation } from '../../../../dist/secrets/operation/answer.js';

import { PASSWORD_FIELD } from './queued_job.mjs';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/g;
const PROVIDER_EFFECTS = Object.freeze(['none', 'changed', 'unknown']);
/** The indentation of the review file a person reads beside the run. */
const JSON_INDENT = '  ';

function sanitizedMessage(reason) {
  return String(reason).replace(CONTROL_CHARACTERS, ' ').trim();
}

// The digest covers the ordered phase verdicts of this run together with the
// identity the run was bound to. No password and no value derived from one is
// ever part of it, so the digest is safe to publish in the receipt.
function evidenceDigest(contract, evidence) {
  const canonical = JSON.stringify({
    account_upn: contract.accountUpn,
    action_log_id: contract.actionLogId,
    evidence,
    operation: contract.operation,
    principal_object_id: contract.principalObjectId,
    request_id: contract.requestId,
    tenant_id: contract.tenantId,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function executionHost() {
  return hostname();
}

// An approval is a resource, not a hint: the id is stable for the exact run and
// phase that asked for it, and the resume token (a random UUID, unguessable and
// within the length the credential contract accepts) is the only way back into
// this operation. It holds until a person answers it.
function approvalResource(contract, phase, providerEffect, instruction) {
  return {
    approval_id: createHash('sha256')
      .update(`${contract.actionLogId}|${phase}`, 'utf8')
      .digest('hex'),
    phase,
    provider_effect: providerEffect,
    resume_token: randomUUID(),
    instruction,
  };
}

// The receipt answers 'was exactly this principal rotated' without reading a
// mailbox or a log, so it names the directory coordinates and digests the
// evidence instead of carrying anything derived from the password. A
// completed answer states changedAt: the time the provider changed, or null
// when the run changed nothing.
function receiptResource(contract, fields) {
  if (!Array.isArray(fields.evidence) || !fields.evidence.length) {
    throw new Error(
      'a credential receipt requires the session evidence of this run',
    );
  }
  if (fields.changedAt === undefined)
    throw new Error(
      'a credential receipt requires changedAt: when the provider changed, or null when it did not',
    );
  return {
    tenant_id: contract.tenantId,
    principal_object_id: contract.principalObjectId,
    account_upn: contract.accountUpn,
    operation: contract.operation,
    request_id: contract.requestId,
    evidence_digest: evidenceDigest(contract, fields.evidence),
    execution_host: executionHost(),
    changed_at: fields.changedAt,
    verified_at: new Date().toISOString(),
    action_log_id: contract.actionLogId,
  };
}

// One shape for every terminal answer, stated where every credential
// operation states its answer (src/secrets/operation/answer.ts), which the
// worker answers the caller from. An approval is also written to the run's
// pending_review.json, where the run's review surfaces show it. The envelope
// stays camelCase; the nested approval and receipt blocks are canonical
// snake_case.
export function outcome(contract, fields) {
  const message = sanitizedMessage(fields.reason);
  if (!PROVIDER_EFFECTS.includes(fields.providerEffect)) {
    throw new Error(
      'an Entra credential outcome requires one exact provider effect',
    );
  }
  const { phase } = fields;
  if (fields.status === 'needs_human_approval' && (!phase || !message)) {
    throw new Error(
      'an approval resource requires the exact phase and instruction that asked for it',
    );
  }
  const answer = {
    status: fields.status,
    ...(fields.code ? { code: fields.code } : {}),
    ...(phase ? { phase } : {}),
    // Only an untouched provider may be retried automatically: 'changed' needs an
    // explicit verify or a confirmed rollback first, and 'unknown' quarantines the
    // item until a human resolves it.
    retryable: fields.providerEffect === 'none' && fields.retryable === true,
    providerEffect: fields.providerEffect,
    ...(fields.rollbackStatus ? { rollbackStatus: fields.rollbackStatus } : {}),
    executionHost: executionHost(),
    tenantId: contract.tenantId,
    principalObjectId: contract.principalObjectId,
    ...(fields.status === 'needs_human_approval'
      ? {
          approval: approvalResource(
            contract,
            phase,
            fields.providerEffect,
            message,
          ),
        }
      : {}),
    ...(fields.status === 'operation_completed'
      ? { receipt: receiptResource(contract, fields) }
      : {}),
    message,
  };
  writeCredentialOperation(answer);
  if (answer.status === 'needs_human_approval') {
    writeFileSync(
      join(runRecordingsDir(), 'pending_review.json'),
      JSON.stringify({ ...answer, reason: message }, null, JSON_INDENT),
    );
  }
  return answer;
}

// Skarbiec write provenance keeps the exact operation: 'rotate' for a rotation,
// 'reset' for a directory reset, 'verify' for a rewrite of the same value, and
// 'rollback' only for compensating restores. The password's bytes are
// overwritten with random ones once written, so no copy outlives the write.
export function commitPassword(contract, password, writeOperation) {
  const secret = Buffer.from(password, 'utf8');
  try {
    writeWelesAcquiredSecret(
      contract.credentialId,
      PASSWORD_FIELD,
      secret,
      contract.skarbiecTenantId,
      {
        accountEmail: contract.accountUpn,
        requestId: contract.requestId,
        operation: writeOperation,
      },
    );
  } finally {
    randomFillSync(secret);
  }
}

/**
 * The managed password Skarbiec holds for the contract, undefined when it
 * holds none; a read Skarbiec refuses raises with its cause, so a refusal is
 * never mistaken for an absent password.
 */
export function managedPassword(contract) {
  return readWelesManagedCredential(
    contract.credentialId,
    PASSWORD_FIELD,
    contract.skarbiecTenantId,
  );
}
