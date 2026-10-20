// The records Weles keeps in Skarbiec: the vault primitives
// (skarbiec-records/vault.ts), the trajectory accounts
// (skarbiec-records/accounts.ts), and here the runtime settings, one record
// per setting key holding its JSON value.

import {
  createRecord,
  readDocument,
  recordIds,
  writeBundle,
  writeDocument,
} from './skarbiec-records/vault.js';

export {
  adoptRecords,
  itemPlayingRole,
  listCredentialItems,
  listServiceMetadata,
  minimumGeneratedLength,
  readDocument,
  writeDocument,
  writeTaggedDocument,
  writeUnchangedDocument,
} from './skarbiec-records/vault.js';
export {
  getAccount,
  listAccounts,
  putAccount,
  putAccountProfile,
  readAccount,
  updateAccount,
  type WelesAccountRecord,
} from './skarbiec-records/accounts.js';

const SETTING_KIND = 'runtime-setting';
const SETTING_KEY = /^[a-z][a-z\d_]*$/;

/** The runtime setting record for `key`, or undefined when none was written. */
function settingRecordId(key: string): string | undefined {
  if (!SETTING_KEY.test(key)) throw new Error(`invalid Weles setting: ${key}`);
  return recordIds(SETTING_KIND).find(
    (id) => readDocument(id).context?.setting_key === key,
  );
}

/**
 * The stored value of one Weles runtime setting, or `absent` when no setting
 * record carries `key` (the state before anything was written). A vault that
 * cannot be read, or a value that is not JSON, is an error naming the setting:
 * read as `absent` it made an unreachable vault look like an empty rate card,
 * an empty burned-proxy list or a follow-up nobody had queued yet.
 */
export function readSetting<T>(key: string, absent: T): T {
  const id = settingRecordId(key);
  if (id === undefined) return absent;
  const raw = readDocument(id).fields?.value_json;
  if (!raw) return absent;
  try {
    return JSON.parse(String(raw)) as T;
  } catch (error) {
    throw new Error(
      `Weles setting ${key} holds no JSON value: ${(error as Error).message}`,
      { cause: error },
    );
  }
}

export function writeSetting<T>(key: string, value: T): void {
  const fields = { value_json: JSON.stringify(value) };
  const existing = settingRecordId(key);
  const id =
    existing === undefined ? createRecord(SETTING_KIND, fields) : existing;
  if (existing !== undefined) writeBundle(id, fields);
  const document = readDocument(id);
  document.context = {
    ...document.context,
    owner: 'weles',
    record_kind: SETTING_KIND,
    setting_key: key,
  };
  writeDocument(id, document);
}
