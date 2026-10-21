// The HTTP status codes the API routes answer with, read from Node's own
// table of standard status codes by their reason phrase, so no route keeps
// its own copy of the numbers.
import { STATUS_CODES } from 'node:http';

function statusOf(phrase) {
  const entry = Object.entries(STATUS_CODES).find(
    ([, standard]) => standard === phrase,
  );
  if (!entry)
    throw new Error(`Node's HTTP status table has no status "${phrase}"`);
  const [code] = entry;
  return Number(code);
}

export const HTTP_OK = statusOf('OK');
export const HTTP_INVALID_REQUEST = statusOf('Bad Request');
export const HTTP_UNAUTHORIZED = statusOf('Unauthorized');
export const HTTP_FORBIDDEN = statusOf('Forbidden');
export const HTTP_NOT_FOUND = statusOf('Not Found');
export const HTTP_TARGET_REFUSED = statusOf('Unprocessable Entity');
export const HTTP_BUSY = statusOf('Too Many Requests');
export const HTTP_SERVER_MISCONFIGURED = statusOf('Internal Server Error');
export const HTTP_UPSTREAM_FAILED = statusOf('Bad Gateway');
