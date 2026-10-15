// The one payload every acquisition path puts on the action queue, and the one
// call that puts it there.
//
// Both queueing paths — a managed password lifecycle and a fresh API-key
// acquisition — hand the worker the same shape, and a dry run returns exactly
// the payload the real run would have queued. Building it once here is what
// makes that promise true: a plan cannot describe a job the queue would not
// produce, because it is the same function.
//
// The constraints block is a contract with the bridge, not a bag of options.
// Which Skarbiec item and field may be written, which origin the credential may
// be captured on, and — for a directory identity — which tenant, principal and
// UPN the trajectory must re-prove are all pinned here, before anything runs.
//
// The objective sentences live one level down, in `queued-job/objective.ts`,
// because they are the only part of this payload a model interprets rather than
// a bridge parses.

import { acquiredSecretContract } from '../scoped-service.js';
import { submitWelesRun } from '../../worker/run-submit/index.js';
import type { AcquireSecretRequest } from './request.js';
import { ENTRA_PROVIDER, type SecretDefinition } from './catalog.js';
import { objectiveFor, purposeFor } from './queued-job/objective.js';

// The bridge's word for a job that goes through no proxy.
const NO_PROXY = 'none';

function lowerCase(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim().toLowerCase();
}

/** One directory coordinate; a directory job without it cannot be built. */
function coordinate(value: string | null | undefined, what: string): string {
  const exact = lowerCase(value);
  if (!exact) throw new Error(`an Entra directory job needs ${what}; the request carries none`);
  return exact;
}

/**
 * The origin the credential may be captured on: the one the Skarbiec contract
 * pins for a registered item, else the signup origin declared for a generic
 * one. A job with neither carries an empty origin, which the bridge refuses.
 */
function captureOrigin(contractOrigin: string | null, def: SecretDefinition): string {
  if (contractOrigin) return contractOrigin;
  if (def.sourceOrigin) return def.sourceOrigin;
  return '';
}

export function paramsFor(
  def: SecretDefinition,
  request: AcquireSecretRequest,
): Record<string, unknown> {
  const accountEmail = lowerCase(request.accountEmail);
  const contract = acquiredSecretContract(def.secret);
  if (!contract)
    throw new Error(
      `missing exact Skarbiec acquisition contract for ${def.secret}`,
    );
  const directory = def.provider === ENTRA_PROVIDER;
  const [envVar] = def.envVars;
  return {
    url: def.formUrl,
    objective: objectiveFor(def, request, accountEmail),
    flow_name: def.flowName,
    execution_mode: 'keeper_first',
    proxy: request.proxy ? request.proxy : NO_PROXY,
    headless: typeof request.headless === 'boolean' ? request.headless : def.headless,
    auto_promote_trajectory: request.autoPromoteTrajectory !== false,
    constraints: {
      secret: def.secret,
      operation: request.operation,
      request_id: request.requestId,
      purpose: purposeFor(request, def),
      account_email: accountEmail,
      store_secret_target: def.storeSecretTarget,
      vault_item_id: contract.item,
      vault_field: contract.field,
      // A registered item pins its source origin in the Skarbiec contract. A
      // generic item has none to pin, so the declared signup origin travels with
      // the job and the worker checks the capture page against exactly it.
      secret_source_origin: captureOrigin(contract.sourceOrigin, def),
      // For microsoft_entra the directory block below is the only source of the
      // identity, so the flat binding tenant stays empty for that provider.
      tenant_id: directory || request.tenantId === null ? undefined : request.tenantId,
      ...(directory
        ? {
            // The directory identity is the item's own write-once contract, not a
            // call argument: the trajectory reads it from exactly this block. The
            // Entra directory id here is not a Weles Skarbiec binding tenant, so
            // the scoped reader and writer stay on the untenanted host binding.
            directory: {
              provider: ENTRA_PROVIDER,
              tenant_id: coordinate(request.tenantId, 'its tenant id'),
              principal_object_id: coordinate(request.principalObjectId, 'its principal object id'),
              account_upn: coordinate(request.accountUpn, 'its account UPN'),
            },
            weles_tenant_id: null,
          }
        : {}),
      display_name: def.displayName,
      env_var: envVar,
      provider: def.provider,
      capabilities: def.capabilities,
      requested_scopes: def.requestedScopes,
      requested_endpoints: def.endpoints,
      expected_daily_requests: def.dailyRequests,
      runtime_install: def.runtimeInstall,
    },
    env: {},
  };
}

/** Start an acquisition action as a detached Weles run and return its run id. */
export function queueAction(
  action: string,
  accountItem: string,
  params: Record<string, unknown>,
  priority?: number,
): Promise<string> {
  return submitWelesRun({
    action,
    accountItem,
    params: priority === undefined ? params : { ...params, priority },
  });
}
