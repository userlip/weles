// Only refusal responses pass through this reader. Successful credential bodies
// remain in the launcher's validated single-field path.
export async function readRefusalDetail(response) {
  try {
    const text = await response.text();
    return text
      .replace(/"value"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"value":"<redacted>"')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (error) {
    return `refusal body read failed: ${error instanceof Error ? error.message : String(error)}`;
  }
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
          ` (${path}): ${cause?.cause?.code ?? cause?.code ?? String(cause)}`,
      );
    }
  };
}
