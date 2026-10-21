// Where Weles reaches Skarbiec and with what: the endpoint the Stado service
// directory names, the owner-only token files Stado issued, a tenant's
// binding directory, and the helper files the executing release carries.

import { randomUUID } from 'node:crypto';
import { constants as fsConstants, lstatSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loopbackHost } from '../../../utils/runtime/service-origin.js';

/** Permission bits no one but the owner may hold on a binding file or directory. */
const NOT_OWNER_ONLY = fsConstants.S_IRWXG | fsConstants.S_IRWXO;

/** The lengths of a UUID's hyphenated parts, read off a UUID this runtime made. */
const UUID_PART_LENGTHS = randomUUID()
  .split('-')
  .map((part) => part.length);

/** Where Stado lays out each tenant's Skarbiec binding directory. */
const TENANTS_ROOT = join(homedir(), '.stado', 'weles-skarbiec-tenants');

/** Whether `metadata` is a regular file or directory only its owner can use. */
function ownedPrivately(metadata: Stats, kind: 'file' | 'directory'): boolean {
  return (
    (kind === 'file' ? metadata.isFile() : metadata.isDirectory()) &&
    !metadata.isSymbolicLink() &&
    (typeof process.getuid !== 'function' ||
      metadata.uid === process.getuid()) &&
    !(metadata.mode & NOT_OWNER_ONLY)
  );
}

/** The directory holding tenant `tenantId`'s Skarbiec binding. */
export function checkedTenantDirectory(tenantId: string): string {
  const parts = tenantId.split('-');
  if (
    !/^[a-f\d-]+$/i.test(tenantId) ||
    parts.length !== UUID_PART_LENGTHS.length ||
    parts.some((part, index) => part.length !== UUID_PART_LENGTHS[index])
  )
    throw new Error(
      `invalid Weles tenant id for Skarbiec binding: ${tenantId} is not a UUID`,
    );
  const directory = join(TENANTS_ROOT, tenantId);
  if (!ownedPrivately(lstatSync(directory), 'directory'))
    throw new Error(
      `refusing unsafe tenant Skarbiec binding directory for ${tenantId}: ${directory} must be a directory only its owner can use`,
    );
  return directory;
}

/** `path`, refused unless it is a regular file only its owner can use. */
export function checkedTenantFile(path: string, label: string): string {
  if (!ownedPrivately(lstatSync(path), 'file'))
    throw new Error(
      `refusing unsafe tenant Skarbiec ${label}: ${path} must be a regular file only its owner can use`,
    );
  return path;
}

/**
 * The Skarbiec origin the Stado service directory names in WC_SKARBIEC_URL:
 * HTTPS, or HTTP on this machine's loopback, with no credentials, query,
 * fragment or path.
 */
export function skarbiecEndpoint(_tenantId?: string | null): string {
  const raw = process.env.WC_SKARBIEC_URL?.trim();
  if (!raw)
    throw new Error(
      'WC_SKARBIEC_URL is required from the Stado service directory; without Skarbiec set WELES_CREDENTIALS_FILE to an owner-only credentials file',
    );
  if (!URL.canParse(raw))
    throw new Error(`WC_SKARBIEC_URL is not a URL: ${JSON.stringify(raw)}`);
  const endpoint = new URL(raw);
  if (
    endpoint.protocol !== 'https:' &&
    !(endpoint.protocol === 'http:' && loopbackHost(endpoint.hostname))
  )
    throw new Error(
      'WC_SKARBIEC_URL must use HTTPS or authenticated loopback HTTP',
    );
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '')
  )
    throw new Error(
      'WC_SKARBIEC_URL must be an origin without credentials, query, or fragment',
    );
  return endpoint.toString().replace(/\/$/, '');
}

/**
 * The token file `fileName` Stado issued (in the tenant's binding directory,
 * or ~/.stado), or null when it was never issued; one that cannot be
 * inspected, or that others could read, is refused with its cause.
 */
export function checkedTokenFile(
  fileName: string,
  tenantId?: string | null,
): string | null {
  const path = tenantId
    ? join(checkedTenantDirectory(tenantId), fileName)
    : join(homedir(), '.stado', fileName);
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `scoped Skarbiec token file ${path} cannot be inspected: ${String(error)}`,
    );
  }
  if (!ownedPrivately(metadata, 'file'))
    throw new Error(
      `refusing unsafe scoped Skarbiec token file for ${fileName}: ${path} must be a regular file only its owner can read`,
    );
  return path;
}

/** A helper or catalog file the executing release carries under src/worker/deploy/acquire. */
export function deployedFile(name: string): string {
  return join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'src',
    'worker',
    'deploy',
    'acquire',
    name,
  );
}
