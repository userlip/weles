// The Google credential entry of the Claude sign-in: the shared entry and the
// shared Google session before the GIS handoff
// (../../_shared/services/google_sso/sign_in/credentials.mjs), with this
// flow's phone approval label.
import {
  enterGoogleCredentials as enterShared,
  establishGoogleSession as establishShared,
} from '../../_shared/services/google_sso/sign_in/credentials.mjs';

const APPROVAL_LABEL = 'claude-google-sign-in';

export function enterGoogleCredentials(args) {
  return enterShared({ ...args, approvalLabel: APPROVAL_LABEL });
}

export function establishGoogleSession(args) {
  return establishShared({ ...args, approvalLabel: APPROVAL_LABEL });
}
