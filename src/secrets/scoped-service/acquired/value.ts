// Whether a value a browser job captured has the shape its acquisition
// contract names, before it is written anywhere. A password is printable
// ASCII without space, quote or backslash, carries an upper- and lower-case
// letter, a digit and a symbol, and is at least as long as the vault policy
// says a generated secret is (statedLength). An API key is letters, digits,
// '.', '-' and '_' with at least one letter and one digit, and carries the
// provider's own prefix where the provider declares one.

import { statedLength } from '../../../utils/identity/password.js';
import {
  resolvedAcquiredSecretContract,
  type WelesAcquiredSecret,
} from '../contracts.js';

const PASSWORD_CHARACTERS = /^[!#-[\]-~]+$/;
const KEY_CHARACTERS = /^[A-Za-z\d._-]+$/;
const HAS_LETTER = /[A-Za-z]/;
const HAS_DIGIT = /\d/;
const HAS_UPPER = /[A-Z]/;
const HAS_LOWER = /[a-z]/;
const HAS_SYMBOL = /[^A-Za-z\d]/;

/** The token prefixes GitHub issues (fine-grained, classic, OAuth, user, server, refresh). */
const GITHUB_TOKEN = /^(?:github_pat_|gh[pousr]_)/;
/** The prefix of a Supabase personal access token. */
const SUPABASE_TOKEN = /^sbp_/;

function matchesShape(shape: string, value: string): boolean {
  if (shape === 'password')
    return (
      PASSWORD_CHARACTERS.test(value) &&
      HAS_UPPER.test(value) &&
      HAS_LOWER.test(value) &&
      HAS_DIGIT.test(value) &&
      HAS_SYMBOL.test(value) &&
      value.length >= statedLength()
    );
  if (!KEY_CHARACTERS.test(value)) return false;
  if (shape === 'github') return GITHUB_TOKEN.test(value);
  if (shape === 'supabase') return SUPABASE_TOKEN.test(value);
  if (shape === 'semantic-scholar' || shape === 'opaque-token')
    return HAS_LETTER.test(value) && HAS_DIGIT.test(value);
  return false;
}

/** Whether `secret` has the shape the acquisition contract of `secretName` names. */
export function isWelesAcquiredSecretValue(
  secretName: WelesAcquiredSecret,
  secret: Buffer,
): boolean {
  const contract = resolvedAcquiredSecretContract(secretName);
  return Boolean(
    contract && matchesShape(contract.shape, secret.toString('latin1')),
  );
}
