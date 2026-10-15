// Which release this process is, and where the tree it was unpacked from sits.
//
// This is read before anything compiled is loaded, because a runtime tree can
// be marked ready while carrying another release's source identity, and a
// server that answers under a version it cannot prove is worse than one that
// never binds its port. Every identity the rest of the server signs into an
// answer -- the published service directory it claims to be, the release
// stamped into a run's recorded outcome -- is the one computed here, so there
// is a single reading of it and not one per caller.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(__dirname, '../../..');
const SOURCE_IDENTITY = JSON.parse(
  readFileSync(join(REPO, 'release', 'source-identity.json'), 'utf8'),
);

// A SHA-256 digest in lowercase hex, as shasum -a 256 prints it.
const SHA256_HEX = /^[0-9a-f]{64}$/; // https://csrc.nist.gov/pubs/fips/180-4/upd1/final SHA-256 is a 256-bit digest
// A Git commit id in lowercase hex.
const GIT_COMMIT_HEX = /^[0-9a-f]{40}$/; // https://git-scm.com/docs/hash-function-transition SHA-1 object names are 40 hex digits

// Both are exported by release/stado-launcher.sh from the payload it
// unpacked: the version from its package.json, the digest from shasum -a 256.
const releaseVersion = process.env.WELES_WORKER_RELEASE_VERSION;
const releaseSha256 = process.env.WELES_WORKER_RELEASE_SHA256;
if (typeof releaseVersion !== 'string' || releaseVersion === '') {
  throw new Error(
    'WELES_WORKER_RELEASE_VERSION is not set: release/stado-launcher.sh sets it from the payload it unpacked, so this process was not started as a release',
  );
}
if (typeof releaseSha256 !== 'string' || !SHA256_HEX.test(releaseSha256)) {
  throw new Error(
    `WELES_WORKER_RELEASE_SHA256 is ${JSON.stringify(releaseSha256)}, not the lowercase SHA-256 of a release payload that release/stado-launcher.sh sets`,
  );
}
if (
  SOURCE_IDENTITY.schema !== 'weles.source-identity.v1' ||
  SOURCE_IDENTITY.product !== 'weles-worker' ||
  SOURCE_IDENTITY.version !== releaseVersion ||
  typeof SOURCE_IDENTITY.source_revision !== 'string' ||
  !GIT_COMMIT_HEX.test(SOURCE_IDENTITY.source_revision)
) {
  throw new Error(
    'embedded Weles source identity does not match the deployed release',
  );
}
export const RUN_RELEASE_IDENTITY = Object.freeze({
  release_version: releaseVersion,
  release_sha256: releaseSha256,
  source_revision: SOURCE_IDENTITY.source_revision,
});
