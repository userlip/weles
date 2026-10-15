// Whether a browser profile is signed in to Meta, read from what Meta itself
// sets: a signed-in browser carries Meta's c_user and xs cookies together.

/**
 * Whether the browser context would send Meta's session cookies to `url`:
 * the cookies are read for that address, so only the ones its host receives
 * are considered.
 */
export async function holdsMetaSession(ctx, url) {
  const names = new Set((await ctx.cookies(url)).map((c) => c.name));
  return names.has('c_user') && names.has('xs');
}
