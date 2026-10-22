import { createHash, createHmac } from 'node:crypto';
import { constants } from 'node:http2';
import type { ArtifactDeliveryConfig } from './delivery-config.js';
import { RequestFailure, isRecord } from './delivery-http.js';
import { canonicalWelesArtifactUri } from './delivery/locator.js';
import declaredKinds from './artifact-kinds.json';

export const SIGN_PATH = '/v1/artifacts/sign';
export const OBJECT_PATH = '/v1/artifacts/object';
// The kinds of artifact a run produces, the keys of `artifact-kinds.json`
// beside this module (each with what it holds), shared by the signing server
// and the uploading client so neither keeps its own copy of the names.
export const ARTIFACT_KINDS: readonly string[] = Object.keys(
  declaredKinds.kinds,
);

/** The kind a run's file is uploaded under and the content type it is stored with. */
export type ArtifactFileType = { kind: string; contentType: string };

const DECLARED_FILE_TYPES: Readonly<Record<string, ArtifactFileType>> =
  Object.fromEntries(
    Object.entries(declaredKinds.kinds).flatMap(([kind, declared]) =>
      Object.entries(declared.files as Record<string, string>).map(
        ([extension, contentType]) => [extension, { kind, contentType }],
      ),
    ),
  );

/**
 * The declared kind and content type of a file with this extension; a type
 * no kind declares is uploaded as the declaration's `undeclared` says, so a
 * capture is never skipped by its extension.
 */
export function artifactFileType(extension: string): ArtifactFileType {
  if (Object.hasOwn(DECLARED_FILE_TYPES, extension))
    return DECLARED_FILE_TYPES[extension];
  return declaredKinds.undeclared;
}

// Signed URLs expire in whole epoch seconds; the Date API counts
// milliseconds, and the epoch's first second measures how many.
export const MILLIS_PER_SECOND = Date.parse('1970-01-01T00:00:01Z');
// A signature is the hex digest of the HMAC's own algorithm, so its length is
// that digest's, not a number kept beside it.
const HMAC_HEX_LENGTH = createHash('sha256').digest('hex').length;

const { HTTP_STATUS_BAD_REQUEST } = constants;

/// A kind is whatever the declaration lists; the locator set carries one
/// list of locators per kind.
export type ArtifactKind = string;

export type ArtifactLocatorSet = Record<ArtifactKind, string[]>;

export type SignedArtifactResponse = {
  artifacts: ArtifactLocatorSet;
  expires_at: string;
};

export function normalizeArtifactLocators(value: unknown): ArtifactLocatorSet {
  if (!isRecord(value))
    throw new RequestFailure(
      HTTP_STATUS_BAD_REQUEST,
      'artifacts must be an object',
    );
  const keys = Object.keys(value);
  if (
    keys.length !== ARTIFACT_KINDS.length ||
    keys.some((key) => !ARTIFACT_KINDS.includes(key))
  )
    throw new RequestFailure(
      HTTP_STATUS_BAD_REQUEST,
      `artifacts must contain exactly ${ARTIFACT_KINDS.join(', ')}`,
    );
  const normalized: ArtifactLocatorSet = {};
  for (const kind of ARTIFACT_KINDS) {
    const entries = value[kind];
    if (!Array.isArray(entries))
      throw new RequestFailure(
        HTTP_STATUS_BAD_REQUEST,
        `artifacts.${kind} must be an array`,
      );
    normalized[kind] = entries.map(canonicalWelesArtifactUri);
  }
  return normalized;
}

function signaturePayload(uri: string, expires: string): string {
  return `GET\n${OBJECT_PATH}\n${uri}\n${expires}`;
}

export function artifactSignature(
  uri: string,
  expires: string,
  secret: string,
): string {
  return createHmac('sha256', secret)
    .update(signaturePayload(uri, expires))
    .digest('hex');
}

/** What a signed object URL carries in its query, each exactly once. */
export type SignedObjectParts = {
  uri: string;
  expires: string;
  signature: string;
};

function signedObjectUrl(
  uri: string,
  expires: string,
  config: ArtifactDeliveryConfig,
): string {
  const parts: SignedObjectParts = {
    uri,
    expires,
    signature: artifactSignature(uri, expires, config.signingSecret),
  };
  const url = new URL(OBJECT_PATH, config.publicBaseUrl);
  url.search = new URLSearchParams(parts).toString();
  return url.toString();
}

/**
 * The parts of a signed object URL's query, or null when it carries another
 * parameter, one of them twice or not at all, or a signature that is not a
 * hex digest of the signing HMAC. The server reads a request with it and the
 * uploading client the URLs it was handed, so both read the one shape
 * signedObjectUrl writes.
 */
export function signedObjectParts(url: URL): SignedObjectParts | null {
  const entries = [...url.searchParams];
  const { uri, expires, signature, ...other } = Object.fromEntries(entries);
  if (
    entries.length !== Object.keys(Object.fromEntries(entries)).length ||
    Object.keys(other).length ||
    uri === undefined ||
    expires === undefined ||
    signature === undefined ||
    !/^[a-f\d]+$/.test(signature) ||
    signature.length !== HMAC_HEX_LENGTH
  )
    return null;
  return { uri, expires, signature };
}

export function signArtifactLocators(
  value: unknown,
  config: ArtifactDeliveryConfig,
  nowMilliseconds: number = Date.now(),
): SignedArtifactResponse {
  const artifacts = normalizeArtifactLocators(value);
  const nowSeconds = Math.floor(nowMilliseconds / MILLIS_PER_SECOND);
  const expires = String(nowSeconds + config.ttlSeconds);
  const signed: ArtifactLocatorSet = Object.fromEntries(
    ARTIFACT_KINDS.map((kind) => [
      kind,
      artifacts[kind].map((uri) => signedObjectUrl(uri, expires, config)),
    ]),
  );
  return {
    artifacts: signed,
    expires_at: new Date(Number(expires) * MILLIS_PER_SECOND).toISOString(),
  };
}
