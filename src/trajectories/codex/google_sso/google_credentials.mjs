// A Google session for the Codex handoff, signed in on Google's own sign-in
// page through the shared Google credential entry
// (../../_shared/services/google_sso/sign_in/credentials.mjs).
import {
  enterGoogleCredentials as enterShared,
  establishGoogleSession as establishShared,
} from '../../_shared/services/google_sso/sign_in/credentials.mjs';

const APPROVAL_LABEL = 'google-sign-in';

/** The shared credential entry, with this flow's approval label. */
export function enterGoogleCredentials(args) {
  return enterShared({ ...args, approvalLabel: APPROVAL_LABEL });
}

/** The shared Google session before the GIS handoff, with this flow's approval label. */
export function establishGoogleSession(args) {
  return establishShared({ ...args, approvalLabel: APPROVAL_LABEL });
}
