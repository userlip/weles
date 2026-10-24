import { describeError } from '../../../_shared/error-chain/index.cjs';

// Only refusal responses pass through this reader. Successful credential bodies
// remain in the launcher's validated single-field path. The detail it answers
// goes into the caller's own refusal, which names the endpoint, the stage and
// the item; a refusal whose body cannot be read is answered with why the read
// failed, so the caller still refuses with its context and its coded stop.
export async function readRefusalDetail(response) {
  let detail;
  try {
    detail = (await response.text())
      .replace(/"value"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"value":"<redacted>"')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (error) {
    detail = `and its body could not be read: ${describeError(error)}`;
  }
  return detail;
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
