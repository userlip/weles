import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { InternalAcquiredSecretContract } from './contracts.js';

const SETTING = 'WELES_MANAGED_PASSWORD_CONTRACTS_FILE';
// An account names its vault item, or the role its item plays as
// `role:<role>`: Skarbiec resolves a role for the acquire, read and stage
// grants these writes use, so the declaration need not name a vault item.
const ITEM = /^(?:role:)?[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ORIGINS: Readonly<Record<string, string>> = Object.freeze({
  microsoft: 'https://account.live.com',
  microsoft_entra: 'https://login.microsoftonline.com',
});

type Declaration = { item: string; provider: string };
// The members each object of the declarations file may carry: the
// weles.managed-passwords.v1 schema's own field names.
const DOCUMENT_SHAPE = Object.freeze({ schema: true, accounts: true });
const ACCOUNT_SHAPE = Object.freeze({ item: true, provider: true });

/** Account names belong to the deployment, not the public executor release. */
export function managedPasswordContracts(): ReadonlyMap<
  string,
  InternalAcquiredSecretContract
> {
  const path = process.env[SETTING]?.trim();
  if (!path) return new Map();
  if (!isAbsolute(path))
    throw new Error(`${SETTING} must name an absolute file path`);
  let document: unknown;
  try {
    const metadata = lstatSync(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (typeof process.getuid === 'function' &&
        metadata.uid !== process.getuid()) ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error(
        'expected a regular owner-only file owned by the executor user',
      );
    }
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `cannot read managed password declarations from ${SETTING} ${path}: ${(error as Error).message}`,
    );
  }
  if (
    !document ||
    typeof document !== 'object' ||
    Array.isArray(document) ||
    Object.keys(document).some((key) => !Object.hasOwn(DOCUMENT_SHAPE, key)) ||
    !('schema' in document) ||
    document.schema !== 'weles.managed-passwords.v1' ||
    !('accounts' in document) ||
    !Array.isArray(document.accounts)
  ) {
    throw new Error(
      `${SETTING} ${path} requires schema weles.managed-passwords.v1 and an accounts array`,
    );
  }
  const contracts = new Map<string, InternalAcquiredSecretContract>();
  for (const [index, value] of document.accounts.entries()) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => !Object.hasOwn(ACCOUNT_SHAPE, key)) ||
      typeof value.item !== 'string' ||
      !ITEM.test(value.item) ||
      typeof value.provider !== 'string' ||
      !Object.hasOwn(ORIGINS, value.provider)
    ) {
      throw new Error(
        `${SETTING} ${path} account ${index} requires an exact item identifier or role:<role> (1–128 ASCII letters, digits, dots, underscores or hyphens, beginning with a letter or digit) and provider microsoft or microsoft_entra`,
      );
    }
    const account = value as Declaration;
    if (contracts.has(account.item))
      throw new Error(`${SETTING} ${path} repeats item ${account.item}`);
    // The writer and reader identities are named after the item or role, never
    // carrying the `role:` prefix, which no consumer name may hold.
    const name = account.item.startsWith('role:')
      ? account.item.slice('role:'.length)
      : account.item;
    contracts.set(
      account.item,
      Object.freeze({
        item: account.item,
        field: 'password',
        writerConsumer: `${name}-writer`,
        writerTokenFile: `${name}-writer-skarbiec-token`,
        readerConsumer: `${name}-reader`,
        sourceOrigin: ORIGINS[account.provider],
        shape: 'password',
      }),
    );
  }
  return contracts;
}
