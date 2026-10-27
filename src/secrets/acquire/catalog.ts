// Which credential a request is actually about.
//
// Everything downstream — the objective sentences, the queued job payload, the
// lifecycle gates — takes a SecretDefinition and asks it questions. This file
// owns that shape and the single resolution from a request to exactly one
// definition: by the managed item its credentialId names, by the secret it
// states, or by the registered contract whose item is its credentialId. No
// definition is guessed from words in a request.
//
// The three sources a definition can come from are separated below it: a managed
// password lifecycle, the enumerated provider table, and a slug nobody
// enumerated. Resolution consults them in that order because it is an order of
// authority — a declared managed password is addressed by its own item id and
// must never be re-read as an API key, and a registered provider must never be
// re-derived from its slug.
//
// The Entra coordinates are re-exported by name because the lifecycle gates and
// the plan builder check a request against exactly the patterns the Entra
// definition was built from; a second copy of those patterns could disagree with
// the definition that uses them.

import {
  acquiredSecretContract,
  isWelesManagedPasswordItem,
} from '../scoped-service.js';
import type { AcquireSecretRequest } from './request.js';
import {
  entraPasswordDefinition,
  microsoftPasswordDefinition,
  ENTRA_ORIGIN,
  ENTRA_PROVIDER,
  ENTRA_UPN,
  LOWER_UUID,
} from './catalog/managed-password.js';
import { SECRET_REGISTRY } from './catalog/registered-providers.js';
import { genericDefinition } from './catalog/unregistered-provider.js';

export { ENTRA_ORIGIN, ENTRA_PROVIDER, ENTRA_UPN, LOWER_UUID };

export type SecretDefinition = {
  secret: string;
  provider: string;
  displayName: string;
  envVars: string[];
  defaultPurpose: string;
  formUrl: string;
  flowName: string;
  endpoints: string[];
  usageText: string;
  dailyRequests: string;
  requestedScopes: string[];
  capabilities: string[];
  runtimeInstall: boolean;
  headless: boolean;
  storeSecretTarget: 'skarbiec';
  operations?: string[];
  // Only a derived generic definition carries this: it is the site the caller
  // declared for an unenumerated provider, empty when none was declared. A
  // registered definition leaves it absent and keeps the origin its exact
  // Skarbiec contract pins.
  sourceOrigin?: string;
};

/**
 * The credential a request names: the managed item its credentialId names, or
 * the secret it states (lower case, words joined by underscores). A request
 * that states neither names none here; definitionFor then resolves it by its
 * credential item.
 */
export function normalizeSecret(
  request: AcquireSecretRequest,
): string | undefined {
  const credentialId = request.credentialId?.trim();
  // Managed item identifiers are exact and case-sensitive. Only the deployment
  // declaration selects their lifecycle; an item's spelling does not.
  if (credentialId && isWelesManagedPasswordItem(credentialId))
    return credentialId;
  return request.secret
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** The registered provider definition a stated secret names, spelled with dots or underscores. */
function registeredNamed(secret: string): SecretDefinition | undefined {
  const registry = SECRET_REGISTRY as Readonly<
    Record<string, SecretDefinition>
  >;
  if (Object.hasOwn(registry, secret)) return registry[secret];
  const underscored = secret.replace(/\./g, '_');
  return Object.hasOwn(registry, underscored)
    ? registry[underscored]
    : undefined;
}

export function definitionFor(
  request: AcquireSecretRequest,
): SecretDefinition | null {
  const normalized = normalizeSecret(request);
  if (normalized && isWelesManagedPasswordItem(normalized)) {
    return acquiredSecretContract(normalized)?.sourceOrigin === ENTRA_ORIGIN
      ? entraPasswordDefinition(normalized)
      : microsoftPasswordDefinition(normalized);
  }
  // An undeclared password must not fall through to a generic api_key writer.
  if (request.provider === 'microsoft' || request.provider === ENTRA_PROVIDER)
    return null;
  const registered = normalized
    ? registeredNamed(normalized)
    : Object.values(SECRET_REGISTRY).find(
        (definition) =>
          acquiredSecretContract(definition.secret)?.item ===
          request.credentialId,
      );
  return registered ? registered : genericDefinition(request);
}
