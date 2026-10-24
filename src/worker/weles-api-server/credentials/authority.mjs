import { readFileSync } from 'node:fs';
import { constants as http } from 'node:http2';
import { readRequest } from '@wisent-ai/weles-client/credential/input';
import { describeError } from '../../../_shared/error-chain/index.cjs';

const CONSUMER = 'weles-credential-admission';
const TOKEN_FILE = 'weles-credential-admission-skarbiec-token';
const CAPABILITY = 'credential-operations';

export class CredentialAdmissionError extends Error {
  // options is Error's own ({ cause }), so the refusal keeps what it wraps.
  constructor(status, code, message, options) {
    super(message, options);
    this.status = status;
    this.code = code;
  }
}

// Resolve each caller against its issuing authority. A revoked or expired
// bearer must not remain usable because the Weles process has not restarted.
export function createCredentialAuthority({
  checkedTokenFile,
  skarbiecEndpoint,
}) {
  return async function authorize(request) {
    // headersDistinct keeps every Authorization line the caller sent, so a
    // second bearer is refused rather than joined or dropped. Node's own
    // header size limit bounds the line.
    const lines = request.headersDistinct.authorization;
    const unauthorized = new CredentialAdmissionError(
      http.HTTP_STATUS_UNAUTHORIZED,
      'WELES_CREDENTIAL_UNAUTHORIZED',
      'one bearer is required',
    );
    if (!lines) throw unauthorized;
    const [header, second] = lines;
    const presented = /^Bearer ([^\s]+)$/i.exec(header);
    if (second !== undefined || !presented) throw unauthorized;
    const [, bearer] = presented;
    let own;
    let endpoint;
    try {
      const path = checkedTokenFile(TOKEN_FILE);
      if (!path) throw new Error(`missing ${TOKEN_FILE}`);
      own = readFileSync(path, 'utf8').trim();
      if (!own || /\s/.test(own)) throw new Error(`invalid ${TOKEN_FILE}`);
      endpoint = skarbiecEndpoint();
    } catch (error) {
      throw new CredentialAdmissionError(
        http.HTTP_STATUS_SERVICE_UNAVAILABLE,
        'WELES_CREDENTIAL_AUTH_UNCONFIGURED',
        describeError(error),
        { cause: error },
      );
    }
    let response;
    let identity;
    try {
      response = await fetch(`${endpoint}/v1/tokens/introspect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${own}`,
          'X-Consumer': CONSUMER,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: bearer }),
      });
      identity = await readRequest(response.body);
    } catch (error) {
      throw new CredentialAdmissionError(
        http.HTTP_STATUS_SERVICE_UNAVAILABLE,
        'WELES_CREDENTIAL_AUTH_UNAVAILABLE',
        `Skarbiec token introspection at ${endpoint} failed: ${describeError(error)}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new CredentialAdmissionError(
        http.HTTP_STATUS_SERVICE_UNAVAILABLE,
        'WELES_CREDENTIAL_AUTH_REFUSED',
        `Skarbiec refused ${CONSUMER} token introspection with HTTP ${response.status}`,
      );
    }
    if (identity.active !== true) {
      throw new CredentialAdmissionError(
        http.HTTP_STATUS_UNAUTHORIZED,
        'WELES_CREDENTIAL_UNAUTHORIZED',
        'bearer is not active',
      );
    }
    if (
      identity.audience !== 'weles' ||
      typeof identity.consumer !== 'string' ||
      !Array.isArray(identity.capabilities) ||
      !identity.capabilities.some(
        (scope) =>
          scope.action === 'call' &&
          scope.item === 'weles' &&
          scope.field === CAPABILITY,
      )
    ) {
      throw new CredentialAdmissionError(
        http.HTTP_STATUS_FORBIDDEN,
        'WELES_CREDENTIAL_SCOPE_REFUSED',
        `bearer requires audience weles and call:weles#${CAPABILITY}`,
      );
    }
    return identity.consumer;
  };
}
