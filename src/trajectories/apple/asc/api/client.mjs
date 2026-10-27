// The App Store Connect API, signed with the Weles App Store Connect API key
// in Skarbiec: one short-lived ES256 token per request (Apple refuses a token
// that lives past twenty minutes; ASC_TOKEN_LIFETIME_SECONDS states how long
// each one lives), Apple's own error answer thrown with the request it
// answers, and list endpoints followed through their next links instead of a
// page cap.
import crypto from 'node:crypto';
import { readScopedSecret } from '../../../../_shared/scoped-secrets.mjs';
import { statedCount } from '../../../_shared/inputs/stated.mjs';

const API = 'https://api.appstoreconnect.apple.com';
// JWT times are whole seconds since the epoch (RFC 7519 NumericDate): the
// epoch's first second, in the Date API's milliseconds.
const MILLISECONDS_PER_SECOND = Date.parse('1970-01-01T00:00:01Z');

const key = {
  id: readScopedSecret('appleAppStoreConnectApi', 'key_id'),
  issuer: readScopedSecret('appleAppStoreConnectApi', 'issuer_id'),
  pem: readScopedSecret('appleAppStoreConnectApi', 'private_key'),
};

function token() {
  const lifetime = statedCount(
    'ASC_TOKEN_LIFETIME_SECONDS',
    'how long one App Store Connect API token lives, in seconds (Apple refuses more than twenty minutes)',
  );
  const issuedAt = Math.floor(Date.now() / MILLISECONDS_PER_SECOND);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const signed = `${encode({ alg: 'ES256', kid: key.id, typ: 'JWT' })}.${encode(
    {
      iss: key.issuer,
      iat: issuedAt,
      exp: issuedAt + lifetime,
      aud: 'appstoreconnect-v1',
    },
  )}`;
  const signature = crypto
    .createSign('SHA256')
    .update(signed)
    .sign({ key: key.pem, dsaEncoding: 'ieee-p1363' });
  return `${signed}.${signature.toString('base64url')}`;
}

/**
 * One request to `path` (under /v1, or a full next link Apple returned).
 * Answers the parsed body, or null when Apple answers without one; any other
 * answer than a success is thrown with Apple's own words.
 */
export async function ascRequest(path, { method, body } = { method: 'GET' }) {
  const url = path.startsWith(API) ? path : `${API}/v1${path}`;
  const answer = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await answer.text();
  if (!answer.ok)
    throw new Error(
      `ASC_API_REFUSED: ${method} ${url} answered HTTP ${answer.status}: ${text}`,
    );
  return text ? JSON.parse(text) : null;
}

/** Every resource a list endpoint holds, page after page through Apple's next links. */
export async function ascAll(path) {
  const all = [];
  for (let next = path; next; ) {
    const page = await ascRequest(next);
    all.push(...page.data);
    next = page.links && page.links.next;
  }
  return all;
}
