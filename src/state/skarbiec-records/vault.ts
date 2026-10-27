// The Skarbiec vault as Weles reads and writes it: the attested Skarbiec
// binary Stado names, its item inventory, documents, tags and policy, and the
// Weles records it keeps (items tagged weles:record:<kind>).

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';

const SKARBIEC_RESOLVER = join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  '_shared',
  'skarbiec-runtime.mjs',
);
let resolvedSkarbiecBinary: string | undefined;

function activeSkarbiecBinary(operation: string): string {
  if (resolvedSkarbiecBinary) return resolvedSkarbiecBinary;
  const result = spawnSync(
    process.execPath,
    [SKARBIEC_RESOLVER, 'active-binary'],
    {
      encoding: 'utf8',
      env: process.env,
      maxBuffer: Infinity,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const binary = String(result.stdout).trim();
  if (result.error || result.status || result.signal || !isAbsolute(binary)) {
    const said = String(result.stderr).trim();
    const detail = result.error
      ? result.error.message
      : said
        ? said
        : result.signal
          ? `resolver was ended by signal ${result.signal}`
          : result.status
            ? `resolver exited with status ${result.status}`
            : binary
              ? 'resolver returned a non-absolute path'
              : 'resolver returned no path';
    throw new Error(
      `cannot ${operation}: Stado returned no attested active Skarbiec binary: ${detail}`,
    );
  }
  resolvedSkarbiecBinary = binary;
  return binary;
}
const VAULT = process.env.SKARBIEC_VAULT_FILE;
// Weles marks each record with the kind it is (Skarbiec namespace
// weles:record:<kind>) and finds one by that tag and its own sealed context;
// an item's id is random and nothing reads meaning out of it.
export const RECORD_TAG_PREFIX = 'weles:record:';

/** Run the Skarbiec command `command` with `args`, `input` on standard input. */
export function skarbiec(
  command: string,
  args: string[],
  input?: string,
): string {
  return execFileSync(
    activeSkarbiecBinary(`run Skarbiec ${command}`),
    [command, ...args],
    {
      input,
      encoding: 'utf8',
      maxBuffer: Infinity,
      env: { ...process.env, SKARBIEC_VAULT_FILE: VAULT },
    },
  );
}

/** The id of an inventory row: its name, else its id. */
export function rowId(row: Record<string, any>): string | undefined {
  const id = row.name ?? row.id;
  return typeof id === 'string' && id ? id : undefined;
}

export function listCredentialItems(): Array<Record<string, any>> {
  const rows = JSON.parse(skarbiec('list', [])) as Array<Record<string, any>>;
  if (!Array.isArray(rows))
    throw new Error('Skarbiec list returned a non-array inventory');
  return rows.filter((row) => !row.deleted && row.state !== 'deleted');
}

/** The ids of the live items of `kind` (every live item when no kind is named). */
export function itemIds(kind?: string): string[] {
  return listCredentialItems()
    .filter((row) => !kind || row.kind === kind)
    .map(rowId)
    .filter((id): id is string => id !== undefined);
}

/**
 * The length the vault's administrative policy requires of a generated
 * secret (`skarbiec policy set min_generated_length <N>`), or null when the
 * operator set none. Every password Weles generates for a new account takes
 * this length: it is the one place that length is stated.
 */
export function minimumGeneratedLength(): number | null {
  const policy = JSON.parse(skarbiec('policy', ['get'])) as Record<
    string,
    unknown
  >;
  const stated = policy?.min_generated_length;
  if (stated === undefined || stated === null) return null;
  if (!Number.isSafeInteger(stated)) {
    throw new Error(
      `Skarbiec's policy min_generated_length is not a whole number: ${JSON.stringify(stated)}`,
    );
  }
  return stated as number;
}

// The Skarbiec tag namespace a consumer selects a secret by (registered by
// Skarbiec for Stado and every product that asks for secrets by role).
const ROLE_TAG_PREFIX = 'stado:role:';
const ROLE = /^[a-z\d][a-z\d-]*$/;

/**
 * The id of the one live item carrying `stado:role:<role>`. The item's id is
 * read only after this selection, so no caller names an item; no holder and
 * several holders are both refused, because reading either would be a guess.
 */
export function itemPlayingRole(role: string): string {
  if (!ROLE.test(role)) throw new Error(`invalid role ${JSON.stringify(role)}`);
  const tag = `${ROLE_TAG_PREFIX}${role}`;
  const [holder, second] = listCredentialItems().filter(
    (row) => Array.isArray(row.tags) && row.tags.includes(tag),
  );
  if (!holder) {
    throw new Error(
      `no Skarbiec item carries ${tag}; store the secret for role ${role} with \`stado credentials item put --host <vault owner> --role ${role}\``,
    );
  }
  if (second)
    throw new Error(
      `several Skarbiec items carry ${tag}; exactly one item may play role ${role}`,
    );
  const id = rowId(holder);
  if (!id) throw new Error(`the Skarbiec item carrying ${tag} has no id`);
  return id;
}

export function readDocument(id: string): Record<string, any> {
  return JSON.parse(skarbiec('get', [id])) as Record<string, any>;
}

export function writeDocument(id: string, document: Record<string, any>): void {
  skarbiec('set', [id], JSON.stringify(document));
}

/** Replace only the exact payload observed by the caller; the vault arbitrates. */
export function writeUnchangedDocument(
  id: string,
  expected: Record<string, any>,
  payload: Record<string, any>,
): void {
  skarbiec(
    'set',
    [id, '--if-unchanged'],
    JSON.stringify({ expected, payload }),
  );
}

/** Write item `id` as `type` carrying exactly `tags`, the payload on stdin. */
export function writeTaggedDocument(
  id: string,
  type: string,
  document: Record<string, any>,
  tags: string[],
): void {
  skarbiec(
    'set',
    [id, '--type', type, '--tags', tags.join(',')],
    JSON.stringify(document),
  );
}

/** The ids of the live items marked as Weles records of `kind`. */
export function recordIds(kind: string): string[] {
  const tag = `${RECORD_TAG_PREFIX}${kind}`;
  return listCredentialItems()
    .filter((row) => Array.isArray(row.tags) && row.tags.includes(tag))
    .map(rowId)
    .filter((id): id is string => id !== undefined);
}

/** Replace `id`'s payload with a bundle holding exactly `fields`, written on stdin so no value is in argv. */
export function writeBundle(
  id: string,
  fields: Record<string, string>,
  tags?: string[],
): void {
  skarbiec(
    'set',
    [id, '--type', 'bundle', ...(tags ? ['--tags', tags.join(',')] : [])],
    JSON.stringify({
      schema: 'skarbiec.item.v2',
      kind: 'bundle',
      fields,
      context: {},
    }),
  );
}

/** A new record of `kind` under a random id; returns the id. */
export function createRecord(
  kind: string,
  fields: Record<string, string>,
): string {
  const id = randomUUID().replaceAll('-', '');
  writeBundle(id, fields, [`${RECORD_TAG_PREFIX}${kind}`]);
  return id;
}

export function listServiceMetadata(
  category?: string,
): Array<Record<string, any>> {
  return itemIds()
    .map((id) => ({ id, document: readDocument(id) }))
    .filter(
      ({ document }) =>
        document.context?.owner === 'weles' ||
        document.context?.source_kind === 'proxy',
    )
    .map(({ id, document }) => ({
      id,
      ...document.context,
      category: document.context?.category ?? document.context?.source_kind,
    }))
    .filter((record) => !category || record.category === category);
}

const RECORD_KIND = /^[a-z][a-z\d-]*$/;

/**
 * Mark every Weles record that carries no `weles:record:<kind>` tag yet with
 * the kind its own context names (`context.owner === 'weles'` and
 * `context.record_kind`). Records written before Weles found them by tag are
 * found again this way; their ids are left as they are and mean nothing.
 * Tags an item already carries are kept.
 */
export function adoptRecords(): {
  tagged: Array<{ id: string; kind: string }>;
  skipped: number;
} {
  const tagged: Array<{ id: string; kind: string }> = [];
  const skipped: string[] = [];
  for (const row of listCredentialItems()) {
    const tags: string[] = Array.isArray(row.tags) ? row.tags.map(String) : [];
    const id = rowId(row);
    if (!id || tags.some((tag) => tag.startsWith(RECORD_TAG_PREFIX))) {
      skipped.push(String(id));
      continue;
    }
    const context = readDocument(id).context;
    const kind = context?.record_kind;
    if (
      context?.owner !== 'weles' ||
      typeof kind !== 'string' ||
      !RECORD_KIND.test(kind)
    ) {
      skipped.push(id);
      continue;
    }
    skarbiec('retag', [
      id,
      '--tags',
      [...tags, `${RECORD_TAG_PREFIX}${kind}`].join(','),
    ]);
    tagged.push({ id, kind });
  }
  return { tagged, skipped: skipped.length };
}
