// The Google credential entry of the Claude sign-in: the shared entry
// (../../_shared/services/google_sso/sign_in/credentials.mjs), with this
// flow's phone approval label.
import { enterGoogleCredentials as enterShared } from '../../_shared/services/google_sso/sign_in/credentials.mjs';

const APPROVAL_LABEL = 'claude-google-sign-in';

export function enterGoogleCredentials(args) {
  return enterShared({ ...args, approvalLabel: APPROVAL_LABEL });
}
