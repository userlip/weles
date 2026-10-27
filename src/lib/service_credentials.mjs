// Weles service credential administration through Skarbiec.
//
// A credential is a Skarbiec login item whose context Weles owns. Every value
// is read as the item states it: a field the item does not carry is absent
// from the row, never filled in, and Skarbiec is run against the vault its own
// configuration names.
import { execFileSync } from 'node:child_process';
import { activeSkarbiecBinary } from '../_shared/skarbiec-runtime.mjs';

let resolvedSkarbiecBinary;

/** The status of a command that did not do what it was asked. */
const EXIT_FAILURE = 1; // https://pubs.opengroup.org/onlinepubs/9799919799/functions/exit.html EXIT_FAILURE

/** The indentation the command's JSON is printed with, for a person to read. */
const PRINTED_INDENT = '  ';

function skarbiec(args, input) {
  return execFileSync(
    (resolvedSkarbiecBinary ??= activeSkarbiecBinary()),
    args,
    { input, encoding: 'utf8', env: process.env },
  );
}

function readItem(id) {
  return JSON.parse(skarbiec(['get', String(id)]));
}

/** The name Skarbiec lists an item under, or a refusal naming the row. */
function listedName(row) {
  const name = typeof row.name === 'string' && row.name ? row.name : row.id;
  if (typeof name !== 'string' || !name) {
    throw new Error(
      `Skarbiec listed an item with neither a name nor an id: ${JSON.stringify(row)}`,
    );
  }
  return name;
}

function listedNames() {
  return JSON.parse(skarbiec(['list']))
    .filter((row) => !row.deleted)
    .map(listedName);
}

/** The record kinds Weles writes into a credential item's context. */
const CREDENTIAL_RECORD_KINDS = new Set([
  'service-credential',
  'service-login',
]);

function allCredentialItems() {
  return listedNames()
    .map((id) => {
      // An item that cannot be read is named; returning null here broke the
      // destructuring filter below with a TypeError that named nothing.
      try {
        return { id, document: readItem(id) };
      } catch (error) {
        throw new Error(
          `Skarbiec credential item ${id} cannot be read: ${String(error)}`,
        );
      }
    })
    .filter(({ document }) =>
      CREDENTIAL_RECORD_KINDS.has(document?.context?.record_kind),
    );
}

/**
 * The row a credential item reads as. The login identifier is the login
 * item's username field; what the item does not carry is left out.
 */
function rowFromItem(id, document) {
  const fields = document.fields;
  const context = document.context;
  if (
    !fields ||
    typeof fields !== 'object' ||
    !context ||
    typeof context !== 'object'
  ) {
    throw new Error(
      `Skarbiec credential item ${id} carries no fields or no context object`,
    );
  }
  return {
    id,
    category: context.category,
    display_name:
      typeof context.display_name === 'string' ? context.display_name : id,
    login_method: context.login_method,
    login_email: fields.username,
    login_password: fields.password,
    metadata: context.metadata,
    updated_at: context.updated_at,
  };
}

function redacted(row) {
  return {
    id: row.id,
    category: row.category,
    display_name: row.display_name,
    login_method: row.login_method,
    login_email: row.login_email,
    updated_at: row.updated_at,
    metadata_keys:
      row.metadata && typeof row.metadata === 'object'
        ? Object.keys(row.metadata).sort()
        : [],
  };
}

export async function listCredentialSummaries({ search } = {}) {
  const terms =
    typeof search === 'string'
      ? search
          .toLowerCase()
          .split(',')
          .map((term) => term.trim())
          .filter(Boolean)
      : [];
  return allCredentialItems()
    .map(({ id, document }) => rowFromItem(id, document))
    .filter(
      (row) =>
        !terms.length ||
        terms.some((term) => row.display_name.toLowerCase().includes(term)),
    )
    .sort((left, right) => left.display_name.localeCompare(right.display_name))
    .map(redacted);
}

// Null only for an item Skarbiec does not list. A listed item that cannot be
// read (vault locked, Skarbiec unreachable) throws its cause instead of
// reading as a credential that does not exist.
export async function getCredential(id) {
  if (!listedNames().includes(String(id))) return null;
  return rowFromItem(String(id), readItem(id));
}

export async function patchCredential(id, patch) {
  const document = readItem(id);
  document.fields = { ...document.fields };
  document.context = { ...document.context };
  if (Object.hasOwn(patch, 'login_email'))
    document.fields.username = patch.login_email;
  if (Object.hasOwn(patch, 'login_password'))
    document.fields.password = patch.login_password;
  for (const key of ['category', 'display_name', 'login_method', 'metadata']) {
    if (Object.hasOwn(patch, key)) document.context[key] = patch[key];
  }
  document.context.updated_at = new Date().toISOString();
  skarbiec(['set', String(id)], JSON.stringify(document));
  return [rowFromItem(String(id), document)];
}

/** The login fields a row states, and only those. */
function statedFields(row) {
  const fields = {};
  if (typeof row.login_email === 'string') fields.username = row.login_email;
  if (typeof row.login_password === 'string')
    fields.password = row.login_password;
  return fields;
}

export async function upsertCredential(row) {
  if (typeof row.id !== 'string' || !/^[a-zA-Z\d][\w:.-]*$/.test(row.id))
    throw new Error('invalid Skarbiec credential item id');
  if (typeof row.login_method !== 'string' || !row.login_method)
    throw new Error(
      `credential ${row.id} states no login_method; say how the account signs in`,
    );
  const id = row.id;
  // Only an item Skarbiec does not list is created. A listed item that cannot
  // be read (vault locked, Skarbiec unreachable) fails here instead of a fresh
  // item being written over its fields and context.
  if (!listedNames().includes(id)) {
    skarbiec(
      ['set', id, '--type', 'login'],
      JSON.stringify({
        schema: 'skarbiec.item.v2',
        kind: 'login',
        fields: statedFields(row),
        context: {},
      }),
    );
  }
  const document = readItem(id);
  document.fields = { ...document.fields, ...statedFields(row) };
  const context = {
    ...document.context,
    owner: 'weles',
    record_kind: 'service-credential',
    display_name: typeof row.display_name === 'string' ? row.display_name : id,
    login_method: row.login_method,
    updated_at: new Date().toISOString(),
  };
  if (Object.hasOwn(row, 'category')) context.category = row.category;
  if (Object.hasOwn(row, 'metadata')) context.metadata = row.metadata;
  document.context = context;
  skarbiec(['set', id], JSON.stringify(document));
  return [rowFromItem(id, document)];
}

export async function ensureKimiGoogleSso({
  id,
  email,
  sourceCredentialId,
} = {}) {
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(
      'ensure-kimi-google-sso needs an explicit destination credential id',
    );
  }
  const source = sourceCredentialId
    ? await getCredential(sourceCredentialId)
    : null;
  const address =
    typeof email === 'string' && email ? email : source?.login_email;
  if (typeof address !== 'string' || !address) {
    throw new Error(
      'ensure-kimi-google-sso needs the Google account address: pass it, or name a source credential that carries login_email',
    );
  }
  const row = {
    id,
    category: 'ai_cli',
    display_name: 'Kimi',
    login_method: 'google_sso',
    login_email: address,
    metadata: {
      account_identifier: address,
      configured_for: 'kimi-code',
      source_credential_id: source ? source.id : null,
      updated_by: 'src/lib/service_credentials.mjs ensure-kimi-google-sso',
      updated_at: new Date().toISOString(),
    },
  };
  if (typeof source?.login_password === 'string')
    row.login_password = source.login_password;
  return upsertCredential(row);
}

const [, script, cmd, first, second, third] = process.argv;
if (import.meta.url === `file://${script}`) {
  const print = (value) =>
    console.log(JSON.stringify(value, null, PRINTED_INDENT));
  if (cmd === 'list') {
    print(await listCredentialSummaries({ search: first }));
  } else if (cmd === 'patch') {
    if (typeof first !== 'string' || typeof second !== 'string') {
      console.error(
        'Usage: node src/lib/service_credentials.mjs patch <id> <json>',
      );
      process.exitCode = EXIT_FAILURE;
    } else {
      print((await patchCredential(first, JSON.parse(second))).map(redacted));
    }
  } else if (cmd === 'ensure-kimi-google-sso') {
    const rows = await ensureKimiGoogleSso({
      id: first,
      sourceCredentialId: second,
      email: third,
    });
    print(rows.map(redacted));
  } else {
    console.error(
      'Usage: node src/lib/service_credentials.mjs list [term,term] | patch <id> <json> | ensure-kimi-google-sso <id> [source_credential_id] [email]',
    );
    process.exitCode = EXIT_FAILURE;
  }
}
