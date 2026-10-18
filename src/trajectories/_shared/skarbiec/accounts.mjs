// Weles' trajectory records in Skarbiec: accounts, the characters and
// products they carry, service credentials and email-domain status. The
// Skarbiec primitives, and why no vault file is named, are in records.mjs.
import { randomUUID } from 'node:crypto';
import {
  liveIds,
  objectMember,
  patchContext,
  readWelesRecord,
  recordIds,
  requireItem,
  run,
  setRecord,
} from './records.mjs';

const ACCOUNT_KIND = 'trajectory-account';
const DOMAIN_KIND = 'email-domain-status';

export { readWelesRecord };

const freshId = () => randomUUID().replaceAll('-', '');

/**
 * The account of `platform` signed in as `username` — active or not — or a
 * new random id for one that does not exist yet.
 */
export function accountItemFor(platform, username) {
  const wanted = String(username).trim().toLowerCase();
  const existing = recordIds(ACCOUNT_KIND)
    .map((id) => readAccount(id))
    .find(
      (account) =>
        account.platform === String(platform) &&
        account.username.trim().toLowerCase() === wanted,
    );
  return existing ? existing.id : freshId();
}

/** Merge the patches into item `id`'s context and fields; either may be absent. */
export function updateWelesRecord(id, contextPatch, fieldPatch) {
  const document = readWelesRecord(id);
  document.context = {
    ...objectMember(id, document, 'context'),
    ...contextPatch,
  };
  document.fields = { ...objectMember(id, document, 'fields'), ...fieldPatch };
  run(['set-json', requireItem(id)], JSON.stringify(document));
  return true;
}

/** The first live item `predicate` accepts, or null when none does. */
export function findWelesRecordId(predicate) {
  for (const id of liveIds()) {
    if (predicate(readWelesRecord(id), id)) return id;
  }
  return null;
}

// A record's payload is the JSON its named field holds (an older record keeps
// it in value_json); a record with neither is its context.
function recordPayload(id, document, fieldName) {
  const fields = objectMember(id, document, 'fields');
  const raw = fieldName in fields ? fields[fieldName] : fields.value_json;
  if (raw) return JSON.parse(String(raw));
  return { ...objectMember(id, document, 'context') };
}

/** The character stored as item `characterId`, carrying its id. */
export function characterRecord(characterId) {
  return {
    id: characterId,
    ...recordPayload(
      characterId,
      readWelesRecord(characterId),
      'character_json',
    ),
  };
}

export function accountCharacter(account) {
  const embedded = account?.metadata?.character;
  if (embedded && typeof embedded === 'object') return embedded;
  const characterId = account?.metadata?.character_id;
  if (typeof characterId !== 'string' || !characterId) return null;
  return characterRecord(characterId);
}

export function findProduct(productId) {
  if (typeof productId !== 'string' || !productId.trim()) return null;
  const wanted = productId.trim();
  const id = findWelesRecordId((document, recordId) => {
    const context = objectMember(recordId, document, 'context');
    return (
      context.record_kind === 'product' &&
      (recordId === wanted || context.product_id === wanted)
    );
  });
  if (!id) return null;
  return { id, ...recordPayload(id, readWelesRecord(id), 'product_json') };
}

export function writeServiceCredentials(service, { username, password }) {
  const kind = 'service-credential';
  const existing = recordIds(kind).find(
    (recordId) =>
      readWelesRecord(recordId).context?.service === String(service),
  );
  const id = existing ? existing : freshId();
  setRecord(kind, id, 'login', {
    username: String(username),
    password: String(password),
  });
  patchContext(id, {
    owner: 'weles',
    record_kind: kind,
    service: String(service),
  });
  return id;
}

/** The status record of `domain`, if one exists. */
function domainRecordId(domain) {
  return recordIds(DOMAIN_KIND).find(
    (recordId) => readWelesRecord(recordId).fields?.domain === String(domain),
  );
}

export function writeDomainStatus(domain, status) {
  const existing = domainRecordId(domain);
  const id = existing ? existing : freshId();
  setRecord(DOMAIN_KIND, id, 'bundle', {
    domain: String(domain),
    status: String(status),
  });
  patchContext(id, {
    owner: 'weles',
    record_kind: DOMAIN_KIND,
    updated_at: new Date().toISOString(),
  });
  return id;
}

// The receiving probe last sent to `domain`, kept in its status record so the
// next health run looks for exactly that mail in the inbox.
export function writeDomainProbe(domain, marker) {
  let id = domainRecordId(domain);
  if (!id) {
    id = freshId();
    setRecord(DOMAIN_KIND, id, 'bundle', {
      domain: String(domain),
      status: 'unprobed',
    });
  }
  patchContext(id, {
    owner: 'weles',
    record_kind: DOMAIN_KIND,
    probe_marker: String(marker),
    probe_sent_at: new Date().toISOString(),
  });
}

// domain -> { marker, sentAt } for every domain with a recorded probe.
export function readDomainProbes() {
  return Object.fromEntries(
    recordIds(DOMAIN_KIND)
      .map((id) => readWelesRecord(id))
      .filter(
        (document) => document.context?.probe_marker && document.fields?.domain,
      )
      .map((document) => [
        document.fields.domain,
        {
          marker: document.context.probe_marker,
          sentAt: document.context.probe_sent_at,
        },
      ]),
  );
}

/** Every active account, of `platform` when one is named. */
export function listAccounts(platform) {
  return recordIds(ACCOUNT_KIND)
    .map((id) => readAccount(id))
    .filter((account) => {
      const active = account.document.context?.active !== false;
      return active && (!platform || account.platform === platform);
    });
}

/** The active account of `platform` signed in as `username`, if any. */
export function findAccount(platform, username) {
  const normalized = String(username).trim().toLowerCase();
  return listAccounts(platform).find(
    (account) => account.username.trim().toLowerCase() === normalized,
  );
}

/** Member `name` of an account record, which writeAccount always stores as text. */
function accountText(id, holder, where, name) {
  const value = holder[name];
  if (typeof value !== 'string')
    throw new Error(`Weles account record ${id} has no ${where}.${name} text`);
  return value;
}

export function readAccount(id) {
  const document = readWelesRecord(id);
  const fields = objectMember(id, document, 'fields');
  const context = objectMember(id, document, 'context');
  return {
    id,
    platform: accountText(id, context, 'context', 'platform'),
    username: accountText(id, fields, 'fields', 'username'),
    password: accountText(id, fields, 'fields', 'password'),
    metadata: JSON.parse(accountText(id, fields, 'fields', 'metadata_json')),
    document,
  };
}

/** Store an account; it is shown under `displayName`, or its username when none is given. */
export function writeAccount({
  id,
  platform,
  username,
  password,
  metadata,
  displayName,
}) {
  const item = requireItem(id);
  if (!metadata || typeof metadata !== 'object')
    throw new Error(`Weles account ${item}: metadata must be an object`);
  setRecord(ACCOUNT_KIND, item, 'bundle', {
    username: String(username),
    password: String(password),
    metadata_json: JSON.stringify(metadata),
  });
  patchContext(item, {
    owner: 'weles',
    record_kind: ACCOUNT_KIND,
    platform: String(platform),
    display_name: String(displayName ? displayName : username),
  });
  return item;
}

/** Rewrite account `id` with `change` applied to what it holds now. */
function rewriteAccount(id, change) {
  const account = readAccount(id);
  writeAccount({
    id: account.id,
    platform: account.platform,
    username: account.username,
    password: account.password,
    metadata: account.metadata,
    displayName: account.document.context.display_name,
    ...change(account),
  });
}

export function replaceAccountMetadata(id, metadata) {
  rewriteAccount(id, () => ({ metadata }));
}

/** Merge `update` (an object, or a function of the metadata) into the metadata. */
export function updateAccountMetadata(id, update) {
  let metadata;
  rewriteAccount(id, (account) => {
    metadata =
      typeof update === 'function'
        ? update(account.metadata)
        : { ...account.metadata, ...update };
    return { metadata };
  });
  return metadata;
}

export function updateAccountPassword(id, password, metadataPatch) {
  rewriteAccount(id, (account) => ({
    password,
    metadata: { ...account.metadata, ...metadataPatch },
  }));
}
