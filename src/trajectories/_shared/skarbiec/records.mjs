// The Skarbiec primitives Weles' trajectory records stand on. Which vault
// serves them is Skarbiec's to choose (the vault Stado declares for this
// machine, or the fleet owner it forwards to, or the one SKARBIEC_VAULT_FILE
// names when the caller names one): naming a vault file here kept the
// records on whichever host held it.
//
// Weles marks each record with the kind it is (Skarbiec namespace
// weles:record:<kind>) and finds one by that tag and its own context; an
// item's id is random and nothing reads meaning out of it.
import { execFileSync } from 'node:child_process';
import { activeSkarbiecBinary } from '../../../_shared/skarbiec-runtime.mjs';

const RECORD_TAG_PREFIX = 'weles:record:';
// An id Skarbiec takes as an item id and never as an option: it starts with
// a letter or digit. Skarbiec refuses an id it cannot store, by its own rule.
const ITEM_ID = /^[A-Za-z\d][\w.:-]*$/;
let resolvedSkarbiecBinary;

export function run(args, input) {
  return execFileSync(
    (resolvedSkarbiecBinary ??= activeSkarbiecBinary()),
    args,
    { input, encoding: 'utf8' },
  );
}

export function requireItem(id) {
  if (!ITEM_ID.test(String(id)))
    throw new Error(`invalid Weles Skarbiec record id: ${JSON.stringify(id)}`);
  return String(id);
}

/** The member `name` of item `id`'s document, which must be an object. */
export function objectMember(id, document, name) {
  const value = document?.[name];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Skarbiec item ${id} carries no ${name} object`);
  return value;
}

/** The id of a row `skarbiec list` answered, refused when it carries none. */
function rowId(row) {
  if (typeof row.id !== 'string' || !row.id)
    throw new Error(
      `skarbiec list answered a row without an id: ${JSON.stringify(row)}`,
    );
  return row.id;
}

/** The ids of every live item. */
export function liveIds() {
  return JSON.parse(run(['list']))
    .filter((row) => !row.deleted)
    .map(rowId);
}

/** The ids of the live items marked as Weles records of `kind`. */
export function recordIds(kind) {
  const tag = `${RECORD_TAG_PREFIX}${kind}`;
  return JSON.parse(run(['list']))
    .filter(
      (row) =>
        !row.deleted && Array.isArray(row.tags) && row.tags.includes(tag),
    )
    .map(rowId);
}

export function readWelesRecord(id) {
  return JSON.parse(run(['get', requireItem(id)]));
}

/**
 * Write a record of `kind` under `id` as an `itemKind` payload holding
 * exactly `fields`, tagging it when it is new. The payload travels on
 * standard input, so no credential value is ever in an argv.
 */
export function setRecord(kind, id, itemKind, fields) {
  const fresh = !recordIds(kind).includes(id);
  run(
    [
      'set',
      id,
      '--type',
      itemKind,
      ...(fresh ? ['--tags', `${RECORD_TAG_PREFIX}${kind}`] : []),
    ],
    JSON.stringify({
      schema: 'skarbiec.item.v2',
      kind: itemKind,
      fields,
      context: {},
    }),
  );
}

/** Merge `patch` into item `id`'s context and write the item back. */
export function patchContext(id, patch) {
  const document = readWelesRecord(id);
  document.context = { ...objectMember(id, document, 'context'), ...patch };
  run(['set', requireItem(id)], JSON.stringify(document));
}
