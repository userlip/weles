import { STATUS_CODES } from 'node:http';

/**
 * The status code node:http knows by its reason phrase, so no module keeps
 * its own copy of the numbers: https://nodejs.org/api/http.html#httpstatus_codes
 */
export function statusCode(reason: string): number {
  const entry = Object.entries(STATUS_CODES).find(
    ([, text]) => text === reason,
  );
  if (!entry) throw new Error(`node:http knows no status "${reason}"`);
  const [code] = entry;
  return Number(code);
}
