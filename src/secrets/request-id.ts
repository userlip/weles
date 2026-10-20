// A credential operation's request id: a SHA-256 digest written in
// hexadecimal, of either case. FIPS 180-4
// (https://csrc.nist.gov/pubs/fips/180-4/upd1/final) makes the digest 256
// bits; its length in hexadecimal digits is read from a digest itself.

import { createHash } from 'node:crypto';

const DIGEST_DIGITS = createHash('sha256').digest('hex').length;
const REQUEST_ID = new RegExp(`^[\\da-f]{${DIGEST_DIGITS}}$`, 'i');

/** Whether `value` is a credential operation request id. */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}
