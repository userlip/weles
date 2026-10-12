// Whether Meta sent the browser to a sign-in, checkpoint or recovery wall
// instead of the page asked for, read from the address's host and route.

// The routes Meta answers a signed-out or held account with.
const WALL_ROUTES = [
  '/login',
  '/business/loginpage',
  '/checkpoint',
  '/recover',
];

/** True when `url` is one of Meta's sign-in, checkpoint or recovery routes. */
export function isLoginUrl(url) {
  if (!URL.canParse(url)) return false;
  const { hostname, pathname } = new URL(url);
  return (
    hostname.endsWith('facebook.com') &&
    WALL_ROUTES.some((route) => pathname.startsWith(route))
  );
}

// The routes Meta's security and two-factor steps live at.
const SECURITY_ROUTES = ['/security', '/two_factor', '/checkpoint'];

/** True when `url` is one of Meta's security-verification routes. */
export function isSecurityWall(url) {
  if (!URL.canParse(url)) return false;
  const { pathname } = new URL(url);
  return SECURITY_ROUTES.some((route) => pathname.includes(route));
}
