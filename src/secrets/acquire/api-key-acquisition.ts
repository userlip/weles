// Queueing the creation of a credential that does not exist yet.
//
// This is the path where a browser job signs up, fills a provider's form and
// generates a key, so the only thing that must be true beforehand is that the
// result has somewhere safe to land and something to be traced to: a scoped
// Skarbiec writer for exactly this item, and one exact request id that becomes
// the trajectory build id. It refuses on nothing else, because everything the
// provider asks for is discovered by the worker, not by the caller.
//
// A dry run returns before either gate. It is a description of the job, not an
// attempt at it, and it is deliberately built from the same payload the real
// enqueue would use so the two can never drift.
//
// The vault item id is read back out of the assembled constraints rather than
// re-derived, because the Skarbiec contract — not this file — decides which item
// a credential is written to.

import { welesAcquiredSecretWriterProblem } from '../scoped-service/transport.js';
import { isRequestId } from '../request-id.js';
import type { AcquireSecretRequest, AcquireSecretResult } from './request.js';
import type { SecretDefinition } from './catalog.js';
import { paramsFor, queueAction } from './queued-job.js';

/** The Skarbiec item the assembled constraints say the credential is written to. */
function constrainedItem(params: Record<string, unknown>, secret: string): string {
  const constraints = params.constraints;
  const item =
    constraints && typeof constraints === 'object' && !Array.isArray(constraints)
      ? (constraints as Record<string, unknown>).vault_item_id
      : undefined;
  if (typeof item !== 'string' || item === '')
    throw new Error(
      `the acquisition job for ${secret} names no Skarbiec item in constraints.vault_item_id`,
    );
  return item;
}

export async function queueAcquisition(
  def: SecretDefinition,
  request: AcquireSecretRequest,
  enqueue: typeof queueAction = queueAction,
): Promise<AcquireSecretResult> {
  const params = paramsFor(def, request);
  const vaultItemId = constrainedItem(params, def.secret);
  if (request.dryRun === true) {
    return {
      status: 'operation_plan',
      operation: 'acquire',
      secret: def.secret,
      vaultItemId,
      provider: def.provider,
      url: def.formUrl,
      objective: String(params.objective),
      params,
    };
  }

  const missing: string[] = [];
  const writerProblem = welesAcquiredSecretWriterProblem(def.secret, request.tenantId);
  if (writerProblem !== null) missing.push(writerProblem);
  const buildId = request.requestId;
  if (!isRequestId(buildId))
    missing.push('one exact credential operation request id');
  if (typeof buildId !== 'string' || missing.length) {
    return {
      status: 'needs_configuration',
      secret: def.secret,
      vaultItemId,
      provider: def.provider,
      missing,
      message: `Cannot enqueue Weles acquisition without ${missing.join(', ')}`,
    };
  }

  const actionLogId = await enqueue(
    'generic_keeper_task',
    '',
    { ...params, trajectory_build_id: buildId },
    request.priority,
  );

  return {
    status: 'operation_queued',
    operation: 'acquire',
    secret: def.secret,
    provider: def.provider,
    buildId,
    actionLogId,
    action: 'generic_keeper_task',
    flowName: def.flowName,
    vaultItemId,
    message: `${def.displayName} API key acquisition queued via generic_keeper_task`,
  };
}
