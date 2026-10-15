// A Google session for the Codex handoff: accounts.google.com, signed in
// through the shared Google credential entry
// (../../_shared/services/google_sso/sign_in/credentials.mjs).
import { enterGoogleCredentials as enterShared } from '../../_shared/services/google_sso/sign_in/credentials.mjs';

const APPROVAL_LABEL = 'google-sign-in';

/** The shared credential entry, with this flow's approval label. */
export function enterGoogleCredentials(args) {
  return enterShared({ ...args, approvalLabel: APPROVAL_LABEL });
}

export async function establishGoogleSession({
  page,
  login,
  mark,
  humanFill,
  humanClickLocator,
  humanType,
}) {
  mark('google_prelogin_goto');
  await page.goto('https://accounts.google.com/ServiceLogin?hl=en', {
    waitUntil: 'commit',
  });
  await enterGoogleCredentials({ page, login, mark, humanFill, humanClickLocator, humanType });
}
