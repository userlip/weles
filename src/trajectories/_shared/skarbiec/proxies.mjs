// The proxy fleet, read from and written to Skarbiec — the one credential
// store. Each `weles-*-proxy` item carries credentials in its fields and all
// non-secret configuration and observed state in its context. A row's
// provider is what its context declares, else what its endpoint shows.
//
// Nothing here prints a secret. Which vault serves the items is Skarbiec's
// to choose (the vault Stado declares for this machine, or the fleet owner
// it forwards to, or the one SKARBIEC_VAULT_FILE names when the caller names
// one): naming a vault file here kept the fleet on whichever host held it.

import { execFileSync } from 'node:child_process';
import { activeSkarbiecBinary } from '../../../_shared/skarbiec-runtime.mjs';
import { providerFromHost } from '../../../../dist/proxy/policy.js';

const PROXY_ITEM = /^weles-.*-proxy$/;
let resolvedSkarbiecBinary;

function skarbiec(args, input) {
  return execFileSync(
    (resolvedSkarbiecBinary ??= activeSkarbiecBinary()),
    args,
    { input, encoding: 'utf8' },
  );
}

/** The member `name` of `document`, which must be an object. */
function objectMember(id, document, name) {
  const value = document?.[name];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Skarbiec proxy item ${id} carries no ${name} object`);
  return value;
}

function readItem(id) {
  return JSON.parse(skarbiec(['get', id]));
}

/** The provider the context declares, else the one its endpoint shows. */
function providerOf(context, fields) {
  if (typeof context.provider === 'string') return context.provider;
  if (typeof context.host === 'string')
    return providerFromHost(context.host, fields.username);
  return undefined;
}

/** The Brightdata zone the item declares, in its context or its metadata. */
function zoneOf(id, context) {
  if (typeof context.zone === 'string') return context.zone;
  if (context.metadata === undefined) return undefined;
  return objectMember(id, context, 'metadata').zone;
}

// A row holds what the item declares; an attribute it does not declare is
// absent from the row, and a caller that needs it decides what that means.
function proxyRecord(id, document) {
  const fields = objectMember(id, document, 'fields');
  const context = objectMember(id, document, 'context');
  return {
    id,
    displayName:
      typeof context.display_name === 'string' ? context.display_name : id,
    host: context.host,
    port: context.port === undefined ? undefined : Number(context.port),
    provider: providerOf(context, fields),
    zone: zoneOf(id, context),
    username: fields.username,
    password: fields.password,
  };
}

function listProxies() {
  return JSON.parse(skarbiec(['list']))
    .filter((item) => !item.deleted && item.kind === 'proxy')
    .map((item) => item.id)
    .filter((id) => PROXY_ITEM.test(id))
    .map((id) => proxyRecord(id, readItem(id)));
}

/** The row named `name` (its display name or a part of it), if any is. */
export function findProxyByDisplayName(name) {
  const wanted = String(name).toLowerCase();
  const slug = wanted.replace(/[^a-z\d]+/g, '-');
  return listProxies().find(
    (proxy) =>
      proxy.displayName.toLowerCase() === wanted ||
      proxy.displayName.toLowerCase().includes(wanted) ||
      proxy.id.includes(slug),
  );
}

// Merge, never replace: probe results and balance updates land beside the
// attributes already in the item's context; credentials are never touched.
export function persistProxyContext(id, patch) {
  const document = readItem(id);
  document.context = { ...objectMember(id, document, 'context'), ...patch };
  skarbiec(['set', id], JSON.stringify(document));
  return true;
}
