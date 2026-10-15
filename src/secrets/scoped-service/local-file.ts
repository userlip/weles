// Credentials kept in one owner-only JSON file, for a machine without
// Skarbiec. WELES_CREDENTIALS_FILE names it; every read and write of a scoped
// or acquired credential then goes to that file and Skarbiec is not asked.
// Only that explicit setting selects it: a fleet host that lost Skarbiec still
// fails with Skarbiec's own refusal instead of reading a file nobody chose.
//
// The file maps an item to its fields, the same names Skarbiec uses:
//   { "weles-account-proxy-credentials": { "0123456789abcdef_username": "…" } }

import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

type Items = Record<string, Record<string, string>>;

/** Read and write for the owner, nothing for group or others. */
const OWNER_ONLY = 0o600; // https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/sys_stat.h.html S_IRUSR | S_IWUSR
/** Every permission bit of the group and of others. */
const GROUP_AND_OTHERS = 0o077; // https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/sys_stat.h.html S_IRWXG | S_IRWXO
/** The indentation the file is written with, for a person to read. */
const INDENT = '  ';

export function localCredentialsFile(): string | null {
  const path = process.env.WELES_CREDENTIALS_FILE?.trim();
  return path ? path : null;
}

function refuseTenant(path: string, tenantId?: string | null): void {
  if (tenantId) {
    throw new Error(
      `WELES_CREDENTIALS_FILE ${path} holds this machine's own credentials; tenant ${tenantId} is read from Skarbiec`,
    );
  }
}

function readItems(path: string): Items {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(
      `WELES_CREDENTIALS_FILE ${path} cannot be read: ${(error as Error).message}`,
    );
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (typeof process.getuid === 'function' &&
      metadata.uid !== process.getuid()) ||
    Boolean(metadata.mode & GROUP_AND_OTHERS)
  ) {
    throw new Error(
      `refusing WELES_CREDENTIALS_FILE ${path}: it must be a regular file owned by this user with mode 600`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `WELES_CREDENTIALS_FILE ${path} is not JSON: ${(error as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `WELES_CREDENTIALS_FILE ${path} must be an object of items`,
    );
  }
  for (const [item, fields] of Object.entries(parsed)) {
    if (
      !fields ||
      typeof fields !== 'object' ||
      Array.isArray(fields) ||
      Object.values(fields).some((value) => typeof value !== 'string')
    ) {
      throw new Error(
        `WELES_CREDENTIALS_FILE ${path}: item ${item} must map field names to strings`,
      );
    }
  }
  return parsed as Items;
}

/**
 * The field's value, or `undefined` when the file does not hold it or holds
 * it empty: an empty string is no credential.
 */
export function readLocalField(
  path: string,
  item: string,
  field: string,
  tenantId?: string | null,
): string | undefined {
  refuseTenant(path, tenantId);
  const items = readItems(path);
  if (!Object.hasOwn(items, item) || !Object.hasOwn(items[item], field))
    return undefined;
  const value = items[item][field];
  return value === '' ? undefined : value;
}

/** Merge `fields` into `item` and replace the file in one rename. */
export function writeLocalFields(
  path: string,
  item: string,
  fields: Record<string, string>,
  tenantId?: string | null,
): void {
  refuseTenant(path, tenantId);
  const items = readItems(path);
  items[item] = {
    ...(Object.hasOwn(items, item) ? items[item] : {}),
    ...fields,
  };
  const staged = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.staged`,
  );
  writeFileSync(staged, JSON.stringify(items, null, INDENT) + '\n', {
    mode: OWNER_ONLY,
    flag: 'wx',
  });
  renameSync(staged, path);
}
