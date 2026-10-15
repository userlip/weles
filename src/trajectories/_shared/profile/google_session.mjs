// Whether a browser profile is signed in to Google, read from what Google
// itself sets: every Google product signs in on one accounts host, and a
// signed-in browser carries Google's SID session cookie in one of its forms.

export const GOOGLE_ACCOUNTS_HOST = 'accounts.google.com';

/** Whether the page at `url` is Google's sign-in host. */
export function onGoogleSignIn(url) {
  return new URL(url).hostname === GOOGLE_ACCOUNTS_HOST;
}

/**
 * Whether the browser context would send Google's session cookie to `url`:
 * the cookies are read for that address, so only the ones its host receives
 * are considered.
 */
export async function holdsGoogleSession(ctx, url) {
  const names = new Set((await ctx.cookies(url)).map((c) => c.name));
  return (
    names.has('SID') ||
    names.has('__Secure-1PSID') ||
    names.has('__Secure-3PSID')
  );
}
