import { describeError } from '../../../_shared/error-chain/index.cjs';

// Only refusal responses pass through this reader. Successful credential bodies
// remain in the launcher's validated single-field path. A refusal whose body
// cannot be read is an error naming its status and why the read failed.
export async function readRefusalDetail(response) {
  let text;
  try {
    text = await response.text();
  } catch (error) {
    throw new Error(
      `HTTP ${response.status} refusal body could not be read: ${describeError(error)}`,
      { cause: error },
    );
  }
  return text
    .replace(/"value"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"value":"<redacted>"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function acquisitionPost({ endpoint, consumer, item, field, stop }) {
  return async function post(path, headers, payload) {
    const target = new URL(path, endpoint);
    try {
      return await fetch(target, { method: 'POST', headers, body: payload });
    } catch (cause) {
      stop(
        'authority_unreachable',
        `Skarbiec at ${endpoint.origin} is unreachable for ${consumer} on ${item}#${field}` +
          ` (${path}): ${describeError(cause)}`,
      );
    }
  };
}
