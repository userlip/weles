#!/usr/bin/env node

// The managed write of one credential Weles captured: PUT /v1/items on the
// Skarbiec the Stado service directory names, as the exact Weles writer
// consumer with its own token. `acquire` stores the whole payload of a new
// acquisition; any other operation stages the one field for the operation's
// request. The item may be a role coordinate, `role:<role>`, which Skarbiec
// resolves itself.
//
// writeWelesAcquiredSecret (src/secrets/scoped-service.ts) runs this file from
// the release with the payload on stdin, after it has checked everything it
// passes: WC_SKARBIEC_URL through skarbiecEndpoint() (HTTPS, or HTTP on
// loopback, an origin without credentials, query or fragment), the token file
// through checkedTokenFile() (a regular file this user owns that no one else
// can read), the request id (64 hex digits) and the operation.

import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { describeError } from '../../../_shared/error-chain/index.cjs';
import { readRefusalDetail } from './transport.mjs';

const [, , consumer, item, field, tokenFile, operation, operationId, ...extra] =
  process.argv;
const exactName = /^[A-Za-z\d._-]+$/;
const exactCoordinate = (value) =>
  exactName.test(
    value.startsWith('role:') ? value.slice('role:'.length) : value,
  );
if (
  extra.length ||
  [consumer, item, field, tokenFile, operation, operationId].some((v) => !v) ||
  !exactName.test(consumer) ||
  !exactCoordinate(item) ||
  !exactName.test(field) ||
  !exactName.test(operation) ||
  !/^[a-f\d]+$/i.test(operationId) ||
  !isAbsolute(tokenFile)
) {
  throw new Error(
    'usage: skarbiec-write.mjs <consumer> <item|role:ROLE> <field> <absolute-token-file> <operation> <operation-id>',
  );
}

const endpointText = process.env.WC_SKARBIEC_URL?.trim();
if (!endpointText)
  throw new Error(
    'WC_SKARBIEC_URL is required from the Stado service directory',
  );
const endpoint = new URL(endpointText);

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const bytes = Buffer.concat(chunks);
const token = readFileSync(tokenFile);
try {
  const payload = JSON.parse(bytes.toString('utf8'));
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    payload.schema !== 'skarbiec.item.v2' ||
    typeof payload.kind !== 'string' ||
    !payload.fields ||
    typeof payload.fields !== 'object' ||
    Array.isArray(payload.fields) ||
    !Object.hasOwn(payload.fields, field)
  ) {
    throw new Error(
      `the payload on stdin is not one skarbiec.item.v2 item carrying field ${field}`,
    );
  }
  // A generic acquire declared its signup origin to Skarbiec, which refuses
  // the write unless the body echoes exactly that origin, and refuses an origin
  // for an operation that declared none: it travels only when the payload
  // carries one, and only as one absolute https origin.
  const captureOrigin = payload.capture_origin;
  if (
    captureOrigin !== undefined &&
    (typeof captureOrigin !== 'string' ||
      !URL.canParse(captureOrigin) ||
      new URL(captureOrigin).protocol !== 'https:' ||
      new URL(captureOrigin).origin !== captureOrigin)
  ) {
    throw new Error(
      `the payload's capture_origin ${JSON.stringify(captureOrigin)} is not one absolute https origin`,
    );
  }
  const bearer = token.toString('utf8');
  if (!bearer || /\s/.test(bearer))
    throw new Error(
      `the Skarbiec writer token in ${tokenFile} is empty or holds whitespace`,
    );
  // Skarbiec's write modes: acquire stores a new acquisition's whole item,
  // stage the one field of an operation on an item Weles controls.
  const mode = operation === 'acquire' ? 'acquire' : 'stage';
  let response;
  try {
    response = await fetch(new URL('/v1/items', endpoint), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json',
        'X-Consumer': consumer,
      },
      body: JSON.stringify({
        id: item,
        field,
        value: mode === 'acquire' ? payload : payload.fields[field],
        mode,
        operation_id: operationId,
        provider_verified: true,
        ...(captureOrigin === undefined
          ? {}
          : { capture_origin: captureOrigin }),
      }),
    });
  } catch (cause) {
    throw new Error(
      `Skarbiec at ${endpoint.origin} is unreachable for ${consumer} writing ${item}#${field}: ${describeError(cause)}`,
      { cause },
    );
  }
  if (!response.ok)
    throw new Error(
      `Skarbiec refused ${consumer} writing ${item}#${field} (${mode}): HTTP ${response.status}: ${await readRefusalDetail(response)}`,
    );
  let answer;
  try {
    answer = await response.text();
  } catch (cause) {
    throw new Error(
      `Skarbiec at ${endpoint.origin} answered ${consumer} writing ${item}#${field} with HTTP ${response.status}, and its body could not be read: ${describeError(cause)}`,
      { cause },
    );
  }
  let result;
  try {
    result = JSON.parse(answer);
  } catch (cause) {
    throw new Error(
      `Skarbiec answered the write of ${item}#${field} with a body that is not JSON (${describeError(cause)}): ${answer}`,
      { cause },
    );
  }
  if (!result || result.ok !== true || result.id !== item)
    throw new Error(
      `Skarbiec answered the write of ${item}#${field} with something other than its own acknowledgement: ${answer}`,
    );
} finally {
  // An empty string zero-fills a Buffer.
  token.fill('');
  bytes.fill('');
  for (const chunk of chunks) chunk.fill('');
}
