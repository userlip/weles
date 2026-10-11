// The one-time code that answers a Google 2FA prompt, from the account's own
// seed: the `totp_secret` field of its Skarbiec item, read into
// login.totpSecret by the login readers (src/utils/login-accounts.ts,
// src/secrets/scoped-service.ts).
//
// A code is never taken from the environment. Whoever typed one there had to
// be present for every sign-in, which is exactly what a stored seed removes.
// An account whose item holds no seed answers null; the sign-in then offers
// the phone approval or refuses with google_2fa_material_missing, and
// `weles run google/authenticator/enrol` stores a seed for that account.
import { generateTotp } from '../../totp_secret.mjs';

export function resolveOtp(login) {
  if (login && login.totpSecret) return generateTotp(login.totpSecret);
  return null;
}
