// Signing the keeper's browser back in when Google interrupts a planner run,
// through the shared keeper Google driver (`_shared/keeper/google_sign_in.mjs`):
// each step Google shows is answered once per address with the Google Ads
// login from Skarbiec, and a repeated or unanswerable step (a refused code,
// a device prompt waiting on a phone) fails the run by name.

import { signInThroughKeeper } from '../../../../_shared/keeper/google_sign_in.mjs';
import { action } from './keeper_browser.mjs';

/** Sign in, resolving the steps answered once the browser leaves Google. */
export async function handleGoogleLogin(creds) {
  return await signInThroughKeeper(action, creds);
}
