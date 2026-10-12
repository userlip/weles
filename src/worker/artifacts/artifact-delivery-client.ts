import {
  normalizeArtifactLocators,
  signedObjectParts,
  ARTIFACT_KINDS,
  MILLIS_PER_SECOND,
  OBJECT_PATH,
  SIGN_PATH,
  type ArtifactKind,
  type ArtifactLocatorSet,
  type SignedArtifactResponse,
} from './artifact-delivery.js';

const MIN_SECRET_BYTES = 32;

export type ArtifactDeliveryClientConfig = {
  baseUrl: string;
  publicBaseUrl: string;
  token: string;
};

function secureOrigin(raw: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  const loopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1' ||
    parsed.hostname === '[::1]';
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  ) {
    throw new Error(
      `${name} must be an origin without credentials, path, query, or fragment`,
    );
  }
  if (
    parsed.protocol !== 'https:' &&
    !(parsed.protocol === 'http:' && loopback)
  ) {
    throw new Error(`${name} must use HTTPS, except for loopback HTTP`);
  }
  return parsed.origin;
}

export function loadArtifactDeliveryClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): ArtifactDeliveryClientConfig {
  const baseUrl = String(env.WELES_ARTIFACT_DELIVERY_URL ?? '').trim();
  const token = String(env.WELES_ARTIFACT_DELIVERY_TOKEN ?? '').trim();
  if (!baseUrl) throw new Error('missing required WELES_ARTIFACT_DELIVERY_URL');
  if (!token) throw new Error('missing required WELES_ARTIFACT_DELIVERY_TOKEN');
  if (Buffer.byteLength(token) < MIN_SECRET_BYTES) {
    throw new Error(
      'WELES_ARTIFACT_DELIVERY_TOKEN must contain at least 32 bytes',
    );
  }
  const origin = secureOrigin(baseUrl, 'WELES_ARTIFACT_DELIVERY_URL');
  return {
    baseUrl: origin,
    publicBaseUrl: origin,
    token,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateSignedResponse(
  value: unknown,
  source: ArtifactLocatorSet,
  config: ArtifactDeliveryClientConfig,
  nowMilliseconds: number,
): SignedArtifactResponse {
  if (
    !isRecord(value) ||
    typeof value.expires_at !== 'string' ||
    !isRecord(value.artifacts)
  ) {
    throw new Error(
      'Weles artifact delivery returned an invalid response envelope',
    );
  }
  const expiryMilliseconds = Date.parse(value.expires_at);
  if (
    !Number.isFinite(expiryMilliseconds) ||
    expiryMilliseconds <= nowMilliseconds
  ) {
    throw new Error('Weles artifact delivery returned an invalid expiry');
  }
  const expectedExpiry = String(
    Math.floor(expiryMilliseconds / MILLIS_PER_SECOND),
  );
  const signed: ArtifactLocatorSet = {};
  for (const kind of ARTIFACT_KINDS) {
    const output = value.artifacts[kind];
    if (
      !Array.isArray(output) ||
      output.length !== source[kind].length ||
      output.some((entry) => typeof entry !== 'string')
    ) {
      throw new Error(
        `Weles artifact delivery changed artifacts.${kind} cardinality`,
      );
    }
    signed[kind] = output.map((entry, index) => {
      const url = new URL(entry as string);
      const parts = signedObjectParts(url);
      if (
        url.origin !== config.publicBaseUrl ||
        Boolean(url.username || url.password || url.hash) ||
        url.pathname !== OBJECT_PATH ||
        !parts ||
        parts.uri !== source[kind].at(index) ||
        parts.expires !== expectedExpiry
      ) {
        throw new Error(
          `Weles artifact delivery returned an invalid artifacts.${kind} URL`,
        );
      }
      return url.toString();
    });
  }
  return { artifacts: signed, expires_at: value.expires_at };
}

export async function requestSignedArtifactUrls(
  artifacts: unknown,
  config: ArtifactDeliveryClientConfig = loadArtifactDeliveryClientConfig(),
): Promise<SignedArtifactResponse> {
  const normalized = normalizeArtifactLocators(artifacts);
  const endpoint = new URL(SIGN_PATH, config.baseUrl);
  const operation = `Weles artifact delivery POST ${endpoint.origin}${endpoint.pathname}`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      body: JSON.stringify({ artifacts: normalized }),
    });
  } catch (error) {
    throw new Error(
      `${operation} request failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new Error(
      `${operation} response body read failed (HTTP ${response.status}): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `${operation} receipt JSON decode failed (HTTP ${response.status}): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const detail =
      isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : text;
    throw new Error(`${operation} HTTP ${response.status}: ${String(detail)}`);
  }
  return validateSignedResponse(payload, normalized, config, Date.now());
}
