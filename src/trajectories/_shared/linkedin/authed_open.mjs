// Opens a LinkedIn page as the signed-in account. When LinkedIn answers with
// its auth wall, the account is signed in again on the same session and the
// page is opened once more; an auth wall after that sign-in is the run's
// failure, since signing in again cannot change it. No attempt count is kept.

import { assertAuthed, AuthProbeError } from '../auth/auth-probe.mjs';
import { reloginLinkedinInline } from './relogin.mjs';

// The auth wall is the auth probe's own error type; no message is read.
const isAuthWall = (error) => error instanceof AuthProbeError;

/**
 * `open` loads the page and checks it is reachable; `label` names the run in
 * the auth probe. Answers { ok: true } once the page is open signed in, or
 * { ok: false, reason } when the sign-in itself was refused.
 */
export async function openLinkedinAuthed(s, acct, label, open) {
  try {
    await open();
    await assertAuthed('linkedin', s, { label });
    return { ok: true };
  } catch (error) {
    if (!isAuthWall(error)) throw error;
  }
  console.log(`[${label}] auth_wall — signing in again on the same session`);
  let refused;
  try {
    await reloginLinkedinInline(s, acct);
  } catch (error) {
    refused = error;
  }
  if (refused) return { ok: false, reason: refused.message };
  await open();
  await assertAuthed('linkedin', s, { label });
  return { ok: true };
}
