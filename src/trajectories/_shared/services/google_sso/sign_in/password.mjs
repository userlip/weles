// Reaching Google's password field and submitting the password, for the
// service sign-ins that start from a provider's "Sign in with Google": the
// shared password steps (./credentials.mjs) reach the field through
// whichever sign-in method Google offers, and read Google's own answer to
// the password. A page that leads to no password field, and a password
// Google refuses, throw with what Google showed.
import { humanFill } from '../../../../../../dist/human/keyboard.js';
import { waitForGooglePassword, waitForGooglePasswordResult } from './credentials.mjs';

export async function submitGooglePassword(page, creds) {
  const password = await waitForGooglePassword({
    page,
    mark: (stage) => console.log(`[google_sso] ${stage}`),
  });
  await humanFill(page, password, creds.password);
  // Google's password form submits on Enter in its field.
  await password.press('Enter');
  await waitForGooglePasswordResult(page);
}
