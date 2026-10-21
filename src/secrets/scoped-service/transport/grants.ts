// What the acquisition catalog in force grants a managed credential's reader:
// the deployment's own catalog when SKARBIEC_WELES_ACQUISITION_SCOPES_FILE
// selects one, a tenant's in its binding directory, else the public catalog
// the release carries.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvedAcquiredSecretContract } from '../contracts.js';
import type { InternalAcquiredSecretContract } from '../contracts.js';
import { localCredentialsFile } from '../local-file.js';
import {
  checkedTenantDirectory,
  checkedTenantFile,
  deployedFile,
} from './binding.js';

/** The scope catalog the acquisition helper is given for `tenantId`. */
export function acquisitionScopesFile(tenantId?: string | null): string {
  if (tenantId)
    return checkedTenantFile(
      join(checkedTenantDirectory(tenantId), 'acquisition-scopes.conf'),
      'acquisition scope catalog',
    );
  // A deployment that keeps its own catalog selects it explicitly; the
  // release's public catalog is the one in force otherwise.
  const selected = process.env.SKARBIEC_WELES_ACQUISITION_SCOPES_FILE?.trim();
  if (selected) return selected;
  return deployedFile('skarbiec-acquisition-scopes.conf');
}

/**
 * The fields the catalog in force grants this contract's exact reader on its
 * item: a row counts only when its consumer column names this reader for the
 * very field the row grants.
 */
function managedReaderGrantedFields(
  contract: InternalAcquiredSecretContract,
  tenantId?: string | null,
): string[] {
  const readerConsumer = contract.readerConsumer;
  if (!readerConsumer) return [];
  const granted: string[] = [];
  for (const line of readFileSync(
    acquisitionScopesFile(tenantId),
    'utf8',
  ).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [consumer, item, field, ...rest] = trimmed.split('|');
    if (rest.length || field === undefined) continue;
    if (item === contract.item && consumer === `${readerConsumer}-${field}`)
      granted.push(field);
  }
  return granted;
}

/**
 * Why the deployed catalog does not let the managed reader of `secretName`
 * read `field`, when it grants the item on another field or cannot be read;
 * null when it grants this field, grants nothing, or no catalog applies.
 */
export function welesManagedCredentialReaderMismatch(
  secretName: string,
  field: string,
  tenantId?: string | null,
): string | null {
  const contract = resolvedAcquiredSecretContract(secretName);
  if (!contract || contract.field !== field || !contract.readerConsumer)
    return null;
  if (localCredentialsFile()) return null;
  let catalog: string;
  let granted: string[];
  try {
    catalog = acquisitionScopesFile(tenantId);
    granted = managedReaderGrantedFields(contract, tenantId);
  } catch (error: unknown) {
    // An unreadable catalog is the reason the reader cannot be checked, not
    // the absence of a mismatch.
    return (
      `deployed Skarbiec acquisition catalog for ${contract.item} cannot be read:` +
      ` ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!granted.length || granted.includes(field)) return null;
  return (
    `deployed Skarbiec acquisition catalog ${catalog} grants ${contract.item}` +
    ` to its reader on ${granted.join(', ')}, but the selected Weles credential` +
    ` contract declares field ${field}`
  );
}

/**
 * Whether the catalog in force grants the managed reader of `secretName`
 * exactly `field`. A catalog that cannot be read is refused with its cause;
 * welesManagedCredentialReaderMismatch says the same as a sentence.
 */
export function hasWelesManagedCredentialReader(
  secretName: string,
  field: string,
  tenantId?: string | null,
): boolean {
  const contract = resolvedAcquiredSecretContract(secretName);
  if (!contract || contract.field !== field || !contract.readerConsumer)
    return false;
  if (localCredentialsFile()) return true;
  return managedReaderGrantedFields(contract, tenantId).includes(field);
}
