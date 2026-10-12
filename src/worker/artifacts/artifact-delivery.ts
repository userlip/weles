import { createHash, createHmac } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { ArtifactDeliveryConfig } from './delivery-config.js';
import {
  RequestFailure,
  bearerAuthorized,
  constantTimeTextEqual,
  deliverObject,
  isRecord,
  jsonResponse,
  listServiceSubscriptions,
  requestJson,
} from './delivery-http.js';
import declaredKinds from './artifact-kinds.json';

export {
  loadArtifactDeliveryConfig,
  type ArtifactDeliveryConfig,
} from './delivery-config.js';

export const SIGN_PATH = '/v1/artifacts/sign';
export const OBJECT_PATH = '/v1/artifacts/object';
const SUBSCRIPTIONS_PATH = '/v1/subscriptions';
const WELES_ARTIFACT_PREFIX = 'stado://weles/recordings/';
// The kinds of artifact a run produces, the keys of `artifact-kinds.json`
// beside this module (each with what it holds). Exported because the
// uploading client used to keep its own copy of the same names, so a kind
// added here was signed by the server and never uploaded by the client.
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
export const MILLIS_PER_SECOND = 1000;
// A signature is the hex digest of the HMAC's own algorithm, so its length is
// that digest's, not a number kept beside it.
const HMAC_HEX_LENGTH = createHash('sha256').digest('hex').length;

/// A kind is whatever the declaration lists; the locator set carries one
/// list of locators per kind.
export type ArtifactKind = string;

export type ArtifactLocatorSet = Record<ArtifactKind, string[]>;

export type SignedArtifactResponse = {
  artifacts: ArtifactLocatorSet;
  expires_at: string;
};

function canonicalWelesArtifactUri(value: unknown): string {
  if (typeof value !== 'string' || value !== value.trim()) {
    throw new RequestFailure(
      400,
      'artifact locator must be a canonical string',
    );
  }
  if (!value.startsWith(WELES_ARTIFACT_PREFIX)) {
    throw new RequestFailure(
      400,
      'artifact locator must use the private Weles recordings namespace',
    );
  }
  if (
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new RequestFailure(
      400,
      'artifact locator contains a forbidden character',
    );
  }
  for (const character of value) {
    if (character.charCodeAt(0) < 32) {
      throw new RequestFailure(
        400,
        'artifact locator contains a control character',
      );
    }
  }

  const relative = value.slice(WELES_ARTIFACT_PREFIX.length);
  const parts = relative.split('/');
  if (
    parts.length < 2 ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new RequestFailure(400, 'artifact locator has an invalid path');
  }
  const runId = parts.at(0) ?? '';
  const runParts = runId.split('-');
  const expectedRunPartLengths = ['8', '4', '4', '4', '12'].map(Number);
  if (
    runId !== runId.toLowerCase() ||
    runParts.length !== expectedRunPartLengths.length ||
    runParts.some(
      (part, index) =>
        part.length !== expectedRunPartLengths.at(index) ||
        !/^[a-f\d]+$/.test(part),
    )
  ) {
    throw new RequestFailure(
      400,
      'artifact locator must contain a canonical run UUID',
    );
  }
  return value;
}

export function normalizeArtifactLocators(value: unknown): ArtifactLocatorSet {
  if (!isRecord(value))
    throw new RequestFailure(400, 'artifacts must be an object');
  const keys = Object.keys(value);
  if (
    keys.length !== ARTIFACT_KINDS.length ||
    keys.some((key) => !ARTIFACT_KINDS.includes(key as ArtifactKind))
  ) {
    throw new RequestFailure(
      400,
      `artifacts must contain exactly ${ARTIFACT_KINDS.join(', ')}`,
    );
  }

  const normalized: ArtifactLocatorSet = {};
  for (const kind of ARTIFACT_KINDS) {
    const entries = value[kind];
    if (!Array.isArray(entries))
      throw new RequestFailure(400, `artifacts.${kind} must be an array`);
    normalized[kind] = entries.map(canonicalWelesArtifactUri);
  }
  return normalized;
}

function signaturePayload(uri: string, expires: string): string {
  return `GET\n${OBJECT_PATH}\n${uri}\n${expires}`;
}

function artifactSignature(
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

function verifiedObjectUri(
  url: URL,
  config: ArtifactDeliveryConfig,
  nowMilliseconds: number,
): string {
  const parts = signedObjectParts(url);
  if (!parts || !/^\d+$/.test(parts.expires)) {
    throw new RequestFailure(403, 'invalid artifact signature');
  }
  const uri = canonicalWelesArtifactUri(parts.uri);
  const { expires, signature } = parts;
  const nowSeconds = Math.floor(nowMilliseconds / MILLIS_PER_SECOND);
  const expirySeconds = Number(expires);
  if (
    !Number.isSafeInteger(expirySeconds) ||
    String(expirySeconds) !== expires ||
    expirySeconds <= nowSeconds ||
    expirySeconds - nowSeconds > config.ttlSeconds
  ) {
    throw new RequestFailure(403, 'artifact URL expired');
  }
  const expected = artifactSignature(uri, expires, config.signingSecret);
  if (!constantTimeTextEqual(signature, expected)) {
    throw new RequestFailure(403, 'invalid artifact signature');
  }
  return uri;
}

export async function handleArtifactDeliveryRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: ArtifactDeliveryConfig,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://weles.internal');
    if (
      request.method === 'GET' &&
      url.pathname === SUBSCRIPTIONS_PATH &&
      !url.search
    ) {
      if (!bearerAuthorized(request, config.subscriptionsToken)) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        throw new RequestFailure(401, 'unauthorized');
      }
      jsonResponse(response, 200, {
        subscriptions: await listServiceSubscriptions(config),
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === SIGN_PATH) {
      if (!bearerAuthorized(request, config.clientToken)) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        throw new RequestFailure(401, 'unauthorized');
      }
      if (
        String(request.headers['content-type'] ?? '')
          .split(';')
          .at(0)
          ?.trim() !== 'application/json'
      ) {
        throw new RequestFailure(415, 'content type must be application/json');
      }
      const body = await requestJson(request);
      if (
        !isRecord(body) ||
        Object.keys(body).length !== 1 ||
        !Object.hasOwn(body, 'artifacts')
      ) {
        throw new RequestFailure(400, 'request must contain exactly artifacts');
      }
      jsonResponse(response, 200, signArtifactLocators(body.artifacts, config));
      return;
    }
    if (request.method === 'GET' && url.pathname === OBJECT_PATH) {
      const uri = verifiedObjectUri(url, config, Date.now());
      await deliverObject(request, response, uri, config);
      return;
    }
    throw new RequestFailure(404, 'not found');
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const status = error instanceof RequestFailure ? error.status : 500;
    const message =
      error instanceof RequestFailure ? error.message : 'internal server error';
    jsonResponse(response, status, { error: message });
  }
}

export function createArtifactDeliveryServer(
  config: ArtifactDeliveryConfig,
): Server {
  return createServer((request, response) => {
    void handleArtifactDeliveryRequest(request, response, config);
  });
}
