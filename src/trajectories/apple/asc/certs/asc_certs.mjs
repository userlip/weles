// App Store Connect: list (and optionally revoke) signing certificates via the
// ASC API — no browser. xcodebuild -allowProvisioningUpdates fails with "your
// account has reached the maximum number of certificates" when the team's cert
// cap is hit; this shows what exists so a stale/expired one can be freed.
//
// Env: REVOKE=<certificateId> to delete one certificate (otherwise read-only).
// The App Store Connect API key is the exact Weles item in Skarbiec, the same
// one asc_register_app.mjs signs with; no key id, issuer or key path is
// written here.
import crypto from 'node:crypto';
import { readScopedSecret } from '../../../../_shared/scoped-secrets.mjs';

const KID = readScopedSecret('appleAppStoreConnectApi', 'key_id');
const ISSUER = readScopedSecret('appleAppStoreConnectApi', 'issuer_id');
const PEM = readScopedSecret('appleAppStoreConnectApi', 'private_key');
if (!KID || !ISSUER || !PEM)
  throw new Error(
    'the Weles App Store Connect API item in Skarbiec lacks key_id, issuer_id or private_key; no request was signed',
  );
const REVOKE = process.env.REVOKE;

const b = (x) =>
  Buffer.from(x)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const n = Math.floor(Date.now() / 1000);
const h = b(JSON.stringify({ alg: 'ES256', kid: KID, typ: 'JWT' }));
const p = b(
  JSON.stringify({
    iss: ISSUER,
    iat: n,
    exp: n + 600,
    aud: 'appstoreconnect-v1',
  }),
);
const sig = crypto
  .createSign('SHA256')
  .update(`${h}.${p}`)
  .sign({ key: PEM, dsaEncoding: 'ieee-p1363' });
const JWT = `${h}.${p}.${b(sig)}`;
const API = 'https://api.appstoreconnect.apple.com/v1';

async function api(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${JWT}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const t = await r.text();
  if (!r.ok) {
    console.log(`HTTP ${r.status} ${opts.method || 'GET'} ${path}: ${t}`);
    throw new Error(`http ${r.status}`);
  }
  return t ? JSON.parse(t) : {};
}

if (process.env.EXPIRE_BUILD) {
  const id = process.env.EXPIRE_BUILD;
  await api(`/builds/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      data: { type: 'builds', id, attributes: { expired: true } },
    }),
  });
  console.log('EXPIRED build', id);
} else if (process.env.ASC_PATH) {
  const j = await api(process.env.ASC_PATH);
  console.log(JSON.stringify(j, null, 2));
} else if (REVOKE) {
  await api(`/certificates/${REVOKE}`, { method: 'DELETE' });
  console.log('REVOKED', REVOKE);
} else {
  const j = await api('/certificates?limit=200');
  const rows = (j.data || []).map((c) => ({
    id: c.id,
    type: c.attributes?.certificateType,
    name: c.attributes?.displayName,
    expiry: c.attributes?.expirationDate,
  }));
  rows.sort((a, b2) => (a.type || '').localeCompare(b2.type || ''));
  console.log(`TOTAL ${rows.length} certificates`);
  for (const r of rows)
    console.log(`${r.id}\t${r.type}\t${r.expiry}\t${r.name}`);
}
