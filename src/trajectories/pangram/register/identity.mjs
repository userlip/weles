import { randomUUID } from 'node:crypto';
import { registrationPassword as generatedPassword } from '../../../../dist/utils/identity/password.js';
import { statedText } from '../../_shared/inputs/stated.mjs';

// The mailbox domains a service address may use are the ones whose mail this
// deployment receives; they are stated, never assumed.
function pickEmailDomain() {
  const domains = statedText(
    ['PANGRAM_EMAIL_DOMAINS'],
    'the comma-separated mailbox domains a generated Pangram address may use',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return domains[Math.floor(Math.random() * domains.length)];
}

/** PANGRAM_EMAIL when set, else a service address on one of the configured domains. */
export function generateEmail() {
  if (process.env.PANGRAM_EMAIL) return process.env.PANGRAM_EMAIL;
  const domain = pickEmailDomain();
  const local =
    process.env.PANGRAM_EMAIL_LOCAL_PART || `svc.pangram.${randomUUID()}`;
  return `${local}@${domain}`;
}

/** PANGRAM_PASSWORD when set, else a password at the vault policy's stated length. */
export function registrationPassword() {
  return process.env.PANGRAM_PASSWORD || generatedPassword();
}
