// Stado's authenticated product object API as Weles writes and reads it: the
// origin and bearer it is reached with, the canonical private URI of an
// object, and the storage receipt a put must answer with.
import { createHash } from 'node:crypto';
import { serviceOrigin } from '../../utils/runtime/service-origin.js';

/**
 * Product objects Weles may write. `weles` holds the per-run recordings tree;
 * `weles-captures` holds the batch capture artifacts (stills, video, sidecars,
 * accessibility results) that generic_capture and generic_accessibility_audit
 * produce, which are addressed by batch/site/axis rather than by run id.
 */
const OBJECT_NAMESPACES: Readonly<Record<string, true>> = Object.freeze({
  weles: true,
  'weles-captures': true,
});

/** The other bearers this process holds, which the object token must not repeat. */
const SIBLING_SECRETS: Readonly<Record<string, true>> = Object.freeze({
  WELES_STADO_MODEL_ROUTER_TOKEN: true,
  WELES_ARTIFACT_DELIVERY_TOKEN: true,
  WELES_ARTIFACT_SIGNING_SECRET: true,
});

export type StadoObjectConfig = { apiUrl: string; token: string };

let stadoObjectConfig: StadoObjectConfig | undefined;

/** STADO_API_URL and the object bearer, or the refusal naming what is wrong. */
export function requireStadoObjectConfig(): StadoObjectConfig {
  if (stadoObjectConfig) return stadoObjectConfig;
  const apiUrl = serviceOrigin('STADO_API_URL', process.env.STADO_API_URL);
  const token = process.env.WELES_STADO_OBJECT_API_TOKEN?.trim();
  if (!token) throw new Error('missing required WELES_STADO_OBJECT_API_TOKEN');
  const repeated = Object.keys(SIBLING_SECRETS).find(
    (name) => process.env[name]?.trim() === token,
  );
  if (repeated !== undefined)
    throw new Error(
      `WELES_STADO_OBJECT_API_TOKEN must be distinct from ${repeated}`,
    );
  stadoObjectConfig = { apiUrl, token };
  return stadoObjectConfig;
}

/** The canonical private URI of `key` in `namespace`, or the refusal naming it. */
export function privateStadoUri(namespace: string, key: string): string {
  if (!Object.hasOwn(OBJECT_NAMESPACES, namespace))
    throw new Error(`invalid Weles object namespace: ${namespace}`);
  if (
    !key ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.includes('\\') ||
    key.includes('?') ||
    key.includes('#') ||
    /\p{Cc}/u.test(key) ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error(`invalid Weles object key: ${key}`);
  return `stado://${namespace}/${key}`;
}

/**
 * The states of Stado's storage-put receipt (stado.storage-put-receipt.v1),
 * each with the `created` it carries: a stored object was created by this
 * put, a replayed one was already there with the same bytes.
 */
const CREATED_BY_RECEIPT_STATE: Readonly<Record<string, boolean>> =
  Object.freeze({ stored: true, replayed: false });

/** The members a storage-put receipt holds, each exactly once. */
const RECEIPT_MEMBERS: Readonly<Record<string, true>> = Object.freeze({
  bytes: true,
  content_type: true,
  created: true,
  schema: true,
  sha256: true,
  state: true,
  uri: true,
});

/** Refuses a receipt that does not acknowledge exactly these bytes at `uri`. */
export function assertStorageReceipt(
  payload: Record<string, unknown>,
  uri: string,
  bytes: Uint8Array,
  contentType: string,
): void {
  const members = Object.keys(payload);
  const state = payload.state;
  if (
    members.length !== Object.keys(RECEIPT_MEMBERS).length ||
    members.some((member) => !Object.hasOwn(RECEIPT_MEMBERS, member)) ||
    payload.schema !== 'stado.storage-put-receipt.v1' ||
    typeof state !== 'string' ||
    !Object.hasOwn(CREATED_BY_RECEIPT_STATE, state) ||
    payload.uri !== uri ||
    payload.sha256 !== createHash('sha256').update(bytes).digest('hex') ||
    payload.bytes !== bytes.byteLength ||
    payload.content_type !== contentType ||
    payload.created !== CREATED_BY_RECEIPT_STATE[state]
  )
    throw new Error(
      `Stado object upload returned an invalid exact storage receipt for ${uri}: ${JSON.stringify(payload)}`,
    );
}
