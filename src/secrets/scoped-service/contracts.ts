// The credential contracts Weles reads and writes through scoped Skarbiec
// consumers: the services' items (catalog/services.ts), and here the
// credentials a browser job acquires, each written by its own scoped writer.

import { managedPasswordContracts } from './managed-passwords.js';
import { SERVICE_CONTRACTS } from './catalog/services.js';

export { SERVICE_CONTRACTS } from './catalog/services.js';

const ACQUIRED_SECRET_CONTRACTS = Object.freeze({
  'semantic_scholar.api_key': Object.freeze({
    item: 'weles-semantic-scholar-api',
    field: 'api_key',
    writerConsumer: 'weles-semantic-scholar-api-writer',
    writerTokenFile: 'weles-semantic-scholar-api-writer-skarbiec-token',
    sourceOrigin: 'https://www.semanticscholar.org',
    shape: 'semantic-scholar',
  }),
  'github.admin_org_token': Object.freeze({
    item: 'weles-github-admin-org-token',
    field: 'api_key',
    writerConsumer: 'weles-github-admin-org-token-writer',
    writerTokenFile: 'weles-github-admin-org-token-writer-skarbiec-token',
    sourceOrigin: 'https://github.com',
    shape: 'github',
  }),
  'figma.personal_access_token': Object.freeze({
    item: 'weles-figma-personal-access-token',
    field: 'api_key',
    writerConsumer: 'weles-figma-personal-access-token-writer',
    writerTokenFile: 'weles-figma-personal-access-token-writer-skarbiec-token',
    sourceOrigin: 'https://www.figma.com',
    shape: 'opaque-token',
  }),
  'snapchat.snap_kit_api_token': Object.freeze({
    item: 'weles-snapchat-snap-kit-api',
    field: 'api_key',
    writerConsumer: 'weles-snapchat-snap-kit-api-writer',
    writerTokenFile: 'weles-snapchat-snap-kit-api-writer-skarbiec-token',
    sourceOrigin: 'https://kit.snapchat.com',
    shape: 'opaque-token',
  }),
  // The item Stado reads by default (`stado dns delegate`). An acquired token
  // is written as kind api-key, field api_key, like every opaque token here.
  'cloudflare.api_token': Object.freeze({
    item: 'cloudflare-api',
    field: 'api_key',
    writerConsumer: 'weles-cloudflare-api-token-writer',
    writerTokenFile: 'weles-cloudflare-api-token-writer-skarbiec-token',
    sourceOrigin: 'https://dash.cloudflare.com',
    shape: 'opaque-token',
  }),
} as const);

export type WelesAcquiredSecret = string;
export type InternalAcquiredSecretContract = {
  item: string;
  field: string;
  writerConsumer: string;
  writerTokenFile: string;
  readerConsumer?: string;
  // Null exactly when no table pins the site: an unenumerated provider has no
  // origin anyone could enumerate, so the signup origin Skarbiec recorded for the
  // acquire operation travels with the job and is checked at capture time.
  sourceOrigin: string | null;
  shape: string;
};
export type WelesAcquiredSecretContract = {
  item: string;
  field: string;
  sourceOrigin: string | null;
};

// One spelling of the signup origin, shared with the `signup_origin` record
// Skarbiec keeps for a generic acquire and with the bridge that carries it: an
// absolute HTTPS origin and nothing else, so a path, query, fragment, userinfo,
// trailing slash, or upper-case host is a different string and is refused rather
// than normalized into one.
export function isWelesAcquiredSourceOrigin(value: string): boolean {
  if (!value || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === 'https:' && url.origin === value;
}

/** An item name nobody enumerated: lower-case letters, digits and inner hyphens. */
const GENERIC_ACQUIRED_ITEM = /^[a-z\d][a-z\d-]*[a-z\d]$/;

export function resolvedAcquiredSecretContract(
  secret: string,
): InternalAcquiredSecretContract | null {
  const managed = managedPasswordContracts();
  for (const item of managed.keys()) {
    if (
      Object.hasOwn(ACQUIRED_SECRET_CONTRACTS, item) ||
      Object.values(ACQUIRED_SECRET_CONTRACTS).some(
        (contract) => contract.item === item,
      ) ||
      Object.values(SERVICE_CONTRACTS).some((service) => service.item === item)
    ) {
      throw new Error(
        `WELES_MANAGED_PASSWORD_CONTRACTS_FILE cannot replace the existing service contract for ${item}`,
      );
    }
  }
  if (Object.hasOwn(ACQUIRED_SECRET_CONTRACTS, secret))
    return (
      ACQUIRED_SECRET_CONTRACTS as Readonly<
        Record<string, InternalAcquiredSecretContract>
      >
    )[secret];
  const declared = managed.get(secret);
  if (declared) return declared;
  // An item nobody enumerated still gets exactly one derived contract: its own
  // scoped writer and its own writer token file, so that operator-owned file
  // stays the only authority that can enable it — there is no fallback to
  // another consumer or token, and no reader consumer, so the derived contract
  // can never be read back. An item another contract already owns is refused
  // here: a derived contract must never reach a table item's or a scoped service
  // item's fields. Only an exact deployment declaration selects a password
  // lifecycle; a generic contract never receives a password reader or origin.
  if (
    !GENERIC_ACQUIRED_ITEM.test(secret) ||
    Object.values(SERVICE_CONTRACTS).some(
      (service) => service.item === secret,
    ) ||
    Object.values(ACQUIRED_SECRET_CONTRACTS).some(
      (contract) => contract.item === secret,
    )
  ) {
    return null;
  }
  return {
    item: secret,
    field: 'api_key',
    writerConsumer: `${secret}-writer`,
    writerTokenFile: `${secret}-writer-skarbiec-token`,
    sourceOrigin: null,
    shape: 'opaque-token',
  };
}

export function acquiredSecretContract(
  secret: string,
): WelesAcquiredSecretContract | null {
  const contract = resolvedAcquiredSecretContract(secret);
  return contract
    ? {
        item: contract.item,
        field: contract.field,
        sourceOrigin: contract.sourceOrigin,
      }
    : null;
}

// Only an exact deployment declaration can select a password lifecycle.
// A name's spelling never implies its provider, origin or account ownership.
export function isWelesManagedPasswordItem(secret: string): boolean {
  const contract = resolvedAcquiredSecretContract(secret);
  return contract?.shape === 'password';
}
