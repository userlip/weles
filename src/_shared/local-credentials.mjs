// The ESM trajectories' side of WELES_CREDENTIALS_FILE: the same owner-only
// JSON file, item -> field -> value, that src/secrets/scoped-service/local-file.ts
// reads and writes for the compiled CommonJS side. The TypeScript build
// emits CommonJS, which cannot load this module synchronously, so the two
// sides each read the one file format; a change to it changes both files.

import { lstatSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Read and write for the owner, nothing for group or others. */
const OWNER_ONLY = 0o600; // https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/sys_stat.h.html S_IRUSR | S_IWUSR
/** Every permission bit of the group and of others. */
const GROUP_AND_OTHERS = 0o077; // https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/sys_stat.h.html S_IRWXG | S_IRWXO
/** The indentation the file is written with, for a person to read. */
const INDENT = '  ';

/** The file WELES_CREDENTIALS_FILE names, or null when it names none. */
export function localCredentialsFile() {
  const named = process.env.WELES_CREDENTIALS_FILE;
  const path = typeof named === 'string' ? named.trim() : '';
  return path === '' ? null : path;
}

/** An error's own sentence, or the thrown value as written. */
function said(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Every item the file holds. A file that does not exist yet holds no item,
 * so a first write creates it; any other unreadable file is refused.
 */
function readItems(path) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(
      `WELES_CREDENTIALS_FILE ${path} cannot be read: ${said(error)}`,
    );
  }
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid() ||
    Boolean(metadata.mode & GROUP_AND_OTHERS)
  ) {
    throw new Error(
      `refusing WELES_CREDENTIALS_FILE ${path}: it must be a regular file owned by this user with mode 600`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `WELES_CREDENTIALS_FILE ${path} is not JSON: ${said(error)}`,
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
  return parsed;
}

/** The field's value; a file without it, or with it empty, is refused by name. */
export function readLocalField(path, item, field) {
  const items = readItems(path);
  const held = Object.hasOwn(items, item) && Object.hasOwn(items[item], field);
  if (!held || items[item][field] === '')
    throw new Error(`WELES_CREDENTIALS_FILE ${path} has no ${item}/${field}`);
  return items[item][field];
}

/** Merge `fields` into `item` and replace the file in one rename. */
export function writeLocalFields(path, item, fields) {
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
