// The credential shape and URLs of microsoft/password_lifecycle.mjs and its steps.

// The managed password's credential id: weles-microsoft-<name>-password, the
// name in lowercase letters, digits and inner hyphens; Skarbiec refuses an id
// it cannot hold.
export const MICROSOFT_PASSWORD_ID =
  /^weles-microsoft-[a-z\d](?:[a-z\d-]*[a-z\d])?-password$/;
export const PASSWORD_FIELD = 'password';
export const PASSWORD_CHANGE_URL = 'https://account.live.com/password/Change';
export const LOGIN_URL = 'https://login.live.com/login.srf';
export const LOGIN_HOSTS = ['login.live.com', 'login.microsoft.com'];
