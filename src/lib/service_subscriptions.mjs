// CRUD helper for Weles subscription records in Skarbiec. A record is marked
// weles:record:service-subscription and found by its own context — service,
// provider and account — never by a name built from them; its id is random.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { activeSkarbiecBinary } from '../_shared/skarbiec-runtime.mjs';

let resolvedSkarbiecBinary;
const VAULT =
  process.env.SKARBIEC_VAULT_FILE ??
  join(homedir(), '.stado', 'skarbiec.vault.json');
const RECORD_TAG = 'weles:record:service-subscription';
const run = (args, input) =>
  execFileSync((resolvedSkarbiecBinary ??= activeSkarbiecBinary()), args, {
    input,
    encoding: 'utf8',
    env: { ...process.env, SKARBIEC_VAULT_FILE: VAULT },
  });
const read = (id) => JSON.parse(run(['get', id]));
const record = (id, document) => ({
  id,
  ...(document.context?.subscription ?? {}),
});

function subscriptionIds() {
  return JSON.parse(run(['list']))
    .filter(
      (row) =>
        !row.deleted &&
        Array.isArray(row.tags) &&
        row.tags.includes(RECORD_TAG),
    )
    .map((row) => String(row.id ?? row.name ?? ''))
    .filter(Boolean);
}

export async function listSubscriptions({
  service,
  status,
  provider,
  account,
} = {}) {
  return subscriptionIds()
    .map((id) => record(id, read(id)))
    .filter(
      (row) =>
        (!service || row.service_name === service) &&
        (!status || row.status === status) &&
        (!provider || row.provider === provider) &&
        (!account || row.account_identifier === account),
    )
    .sort((left, right) =>
      String(right.updated_at).localeCompare(String(left.updated_at)),
    );
}

function requireObservation(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row))
    throw new Error('subscription row must be a JSON object; nothing was written');
  const missing = Object.entries({
    service_name: row.service_name,
    provider: row.provider,
    account_identifier: row.account_identifier,
    status: row.status,
    last_verified_at: row.last_verified_at,
  })
    .filter(([, value]) => typeof value !== 'string' || !value.trim())
    .map(([name]) => name);
  if (missing.length)
    throw new Error(
      `subscription record for ${row.service_name}/${row.account_identifier} has no ${missing.join(', ')}: what was observed, and when, is the collector's to state; nothing was written`,
    );
  if (Number.isNaN(Date.parse(row.last_verified_at)))
    throw new Error(
      'subscription last_verified_at must be a date-time the collector observed; nothing was written',
    );
}

export async function getSubscription(id) {
  const found = (await listSubscriptions()).find((row) => row.id === id);
  if (!found) throw new Error(`service subscription record ${id} not found`);
  return found;
}

export async function upsertSubscription(row) {
  requireObservation(row);
  const existing = (
    await listSubscriptions({
      service: row.service_name,
      provider: row.provider,
      account: row.account_identifier,
    })
  )[0]?.id;
  const id = existing ?? randomUUID().replaceAll('-', '');
  run(
    [
      'set-json',
      id,
      '--type',
      'bundle',
      ...(existing ? [] : ['--tags', RECORD_TAG]),
    ],
    JSON.stringify({
      schema: 'skarbiec.item.v2',
      kind: 'bundle',
      fields: { value_json: JSON.stringify(row.metadata ?? {}) },
      context: {},
    }),
  );
  const document = read(id);
  document.context = {
    ...(document.context ?? {}),
    owner: 'weles',
    record_kind: 'service-subscription',
    subscription: {
      ...row,
      id,
      updated_at: new Date().toISOString(),
    },
  };
  run(['set-json', id], JSON.stringify(document));
  return [record(id, document)];
}

export async function updateSubscription(id, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('subscription patch must be a JSON object; nothing was written');
  if (
    Object.hasOwn(patch, 'status') !==
    Object.hasOwn(patch, 'last_verified_at')
  )
    throw new Error(
      'subscription status and last_verified_at must be supplied together for a new observation; nothing was written',
    );
  const current = await getSubscription(id);
  requireObservation({ ...current, ...patch });
  const document = read(id);
  document.context.subscription = {
    ...current,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  run(['set-json', id], JSON.stringify(document));
  return [record(id, document)];
}

export async function deleteSubscription(id) {
  await getSubscription(id);
  run(['delete', String(id)]);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , command, ...args] = process.argv;
  const [id, input] = args;
  const required = (value, name) => {
    if (!value) throw new Error(`missing ${name}; nothing was written`);
    return value;
  };
  let result;
  if (command === 'list') result = await listSubscriptions();
  else if (command === 'get')
    result = await getSubscription(required(id, 'record id'));
  else if (command === 'upsert')
    result = await upsertSubscription(JSON.parse(required(id, 'row JSON')));
  else if (command === 'update')
    result = await updateSubscription(
      required(id, 'record id'),
      JSON.parse(required(input, 'patch JSON')),
    );
  else if (command === 'delete')
    result = {
      id: required(id, 'record id'),
      deleted: await deleteSubscription(id),
    };
  else
    throw new Error(
      "Usage: node src/lib/service_subscriptions.mjs list|get ID|upsert '<row-json>'|update ID '<patch-json>'|delete ID",
    );
  console.log(JSON.stringify(result, null, 2));
}
