// A journey's route to third-party providers: `POST
// /api/integration/<domain>/<action>` on wisent-integrations, which holds the
// provider keys. A journey holds only Weles' integration bearer
// (WELES_STADO_INTEGRATION_TOKEN) and the service origin
// (STADO_INTEGRATION_API_URL). The compiled twin is src/utils/integrations.ts.

/** A variable as the environment states it, blank read as unset. */
function stated(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function integrationsConfigured() {
  return (
    stated('STADO_INTEGRATION_API_URL') !== null &&
    stated('WELES_STADO_INTEGRATION_TOKEN') !== null
  );
}

/**
 * One integration action. A refusal names the endpoint, the HTTP status and
 * the boundary's own error body, so a failed provider step says what failed.
 */
export async function integrationAction(domain, action, body) {
  const base = stated('STADO_INTEGRATION_API_URL');
  const token = stated('WELES_STADO_INTEGRATION_TOKEN');
  if (base === null)
    throw new Error(
      `${domain}/${action}: STADO_INTEGRATION_API_URL is not set, so wisent-integrations cannot be reached`,
    );
  if (token === null)
    throw new Error(
      `${domain}/${action}: WELES_STADO_INTEGRATION_TOKEN is not set, so wisent-integrations would refuse the call`,
    );
  const endpoint = new URL(
    `api/integration/${domain}/${action}`,
    base.endsWith('/') ? base : `${base}/`,
  );
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    const shown =
      text.trim() === '' ? 'an empty body' : `the body ${text.trim()}`;
    throw new Error(
      `${endpoint} answered HTTP ${response.status} with ${shown}, which is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok || envelope?.ok !== true || !envelope.result) {
    // The boundary's own error when it states one, else the whole envelope.
    const refusal =
      envelope &&
      typeof envelope === 'object' &&
      Object.hasOwn(envelope, 'error')
        ? envelope.error
        : envelope;
    throw new Error(
      `${endpoint} answered HTTP ${response.status}: ${JSON.stringify(refusal)}`,
    );
  }
  return envelope.result;
}
