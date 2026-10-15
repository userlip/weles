// Opening App Store Connect on the Apple session apple/login.mjs stored. A
// session Apple no longer accepts is sent to its sign-in host; that is
// refused by name, so the caller knows to sign in again.
import { pageSettled } from '../_shared/page/settled.mjs';

export const ASC = 'https://appstoreconnect.apple.com';
const APPLE_SIGN_IN_HOST = 'idmsa.apple.com';

/** Open `path` on App Store Connect; a session sent to Apple's sign-in throws ASC_SESSION_EXPIRED. */
export async function openAppStoreConnect(s, path) {
  await s.goto(`${ASC}${path}`);
  await pageSettled(s.page);
  if (new URL(s.page.url()).hostname === APPLE_SIGN_IN_HOST)
    throw new Error(
      `ASC_SESSION_EXPIRED: App Store Connect sent the session to Apple's sign-in (${s.page.url()}); run apple/login.mjs`,
    );
}
