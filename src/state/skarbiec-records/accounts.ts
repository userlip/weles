// The trajectory accounts Weles keeps in Skarbiec: one record per platform
// account, its username and password in the item's fields, its metadata as
// JSON beside them, and its platform, display name and active flag in the
// item's sealed context.

import {
  createRecord,
  readDocument,
  recordIds,
  writeBundle,
  writeDocument,
} from './vault.js';

export interface WelesAccountRecord {
  id: string;
  platform: string;
  username: string;
  /** Empty for an account whose credential credential intake has not written yet. */
  password: string;
  active: boolean;
  metadata: Record<string, any>;
  context: Record<string, any>;
}

const ACCOUNT_KIND = 'trajectory-account';

/** The account record item `id` holds; one without a platform or username is refused naming the item. */
function accountFromDocument(
  id: string,
  document: Record<string, any>,
): WelesAccountRecord {
  const fields = { ...document.fields };
  const context = { ...document.context };
  if (typeof context.platform !== 'string' || !context.platform)
    throw new Error(`Skarbiec account record ${id} names no platform`);
  if (typeof fields.username !== 'string' || !fields.username)
    throw new Error(`Skarbiec account record ${id} holds no username`);
  return {
    id,
    platform: context.platform,
    username: fields.username,
    password: typeof fields.password === 'string' ? fields.password : '',
    active: context.active !== false,
    metadata: fields.metadata_json
      ? JSON.parse(String(fields.metadata_json))
      : {},
    context,
  };
}

/** The account of `platform` signed in as `username`, active or not. */
function findAccountId(platform: string, username: string): string | undefined {
  const wanted = username.trim().toLowerCase();
  return recordIds(ACCOUNT_KIND).find((id) => {
    const account = accountFromDocument(id, readDocument(id));
    return (
      account.platform === platform &&
      account.username.trim().toLowerCase() === wanted
    );
  });
}

/** Active trajectory accounts, optionally of one platform. */
export function listAccounts(platform?: string): WelesAccountRecord[] {
  return recordIds(ACCOUNT_KIND)
    .map((id) => accountFromDocument(id, readDocument(id)))
    .filter(
      (account) =>
        account.active && (!platform || account.platform === platform),
    );
}

/** One account record whether active or not, or null when no such account exists. */
export function readAccount(id: string): WelesAccountRecord | null {
  if (!recordIds(ACCOUNT_KIND).includes(id)) return null;
  return accountFromDocument(id, readDocument(id));
}

/** One active account a trajectory may use; an inactive (banned, deleted) account is not returned. */
export function getAccount(id: string): WelesAccountRecord | null {
  const account = readAccount(id);
  return account?.active ? account : null;
}

/** The metadata item `document` holds, merged with `patch`. */
function mergedMetadata(
  document: Record<string, any>,
  patch: Record<string, unknown>,
): string {
  const held = document.fields?.metadata_json;
  const current = held ? JSON.parse(String(held)) : {};
  return JSON.stringify({ ...current, ...patch });
}

/**
 * Write an account's profile without touching its credential fields: an
 * existing item keeps username and password and gains the metadata, display
 * name and active flag; a new item holds the username and metadata only, and
 * its credential is written later through credential intake.
 */
export function putAccountProfile(record: {
  platform: string;
  username: string;
  metadata: Record<string, unknown>;
  displayName?: string;
}): string {
  const existing = findAccountId(record.platform, record.username);
  const id =
    existing === undefined
      ? createRecord(ACCOUNT_KIND, {
          username: record.username,
          metadata_json: JSON.stringify(record.metadata),
        })
      : existing;
  const document = readDocument(id);
  document.fields = {
    ...document.fields,
    metadata_json: mergedMetadata(document, record.metadata),
  };
  const shown = record.displayName ?? document.context?.display_name;
  document.context = {
    ...document.context,
    owner: 'weles',
    record_kind: ACCOUNT_KIND,
    platform: record.platform,
    display_name: shown ? shown : record.username,
    active: true,
  };
  writeDocument(id, document);
  return id;
}

export function putAccount(record: {
  platform: string;
  username: string;
  password: string;
  metadata: Record<string, unknown>;
  displayName?: string;
}): string {
  const fields = {
    username: record.username,
    password: record.password,
    metadata_json: JSON.stringify(record.metadata),
  };
  const existing = findAccountId(record.platform, record.username);
  const id =
    existing === undefined ? createRecord(ACCOUNT_KIND, fields) : existing;
  if (existing !== undefined) writeBundle(id, fields);
  const document = readDocument(id);
  document.context = {
    ...document.context,
    owner: 'weles',
    record_kind: ACCOUNT_KIND,
    platform: record.platform,
    display_name: record.displayName ? record.displayName : record.username,
    active: true,
  };
  writeDocument(id, document);
  return id;
}

/** Merge `patch` into account `id`'s metadata and active flag; false when no such account exists. */
export function updateAccount(
  id: string,
  patch: { metadata?: Record<string, any>; active?: boolean },
): boolean {
  if (!recordIds(ACCOUNT_KIND).includes(id)) return false;
  const document = readDocument(id);
  if (patch.metadata)
    document.fields = {
      ...document.fields,
      metadata_json: mergedMetadata(document, patch.metadata),
    };
  document.context = {
    ...document.context,
    ...(patch.active === undefined ? {} : { active: patch.active }),
  };
  writeDocument(id, document);
  return true;
}
