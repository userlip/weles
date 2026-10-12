// What Chromium's network error code in a failed navigation says about the
// route to a site: its edge answered with a refusal (the exit is blocked and
// has to be rotated out) or the proxy never carried the request. The code is
// the browser's own structured answer; a page's prose is never read here.

// The site's edge refused the request (an HTTP error response, or a block).
const EDGE_REFUSALS = [
  'ERR_HTTP_RESPONSE_CODE_FAILURE',
  'ERR_BLOCKED_BY_RESPONSE',
  'ERR_BLOCKED_BY_CLIENT',
  'ERR_BLOCKED_BY_ADMINISTRATOR',
];

// The proxy did not carry the request to the site.
const PROXY_FAILURES = [
  'ERR_TUNNEL_CONNECTION_FAILED',
  'ERR_PROXY_CONNECTION_FAILED',
  'ERR_TIMED_OUT',
];

/**
 * 'ip_blocked' when the error carries an edge refusal, 'proxy_failed' when it
 * carries a proxy failure or the page ended on Chromium's own error page, and
 * 'reached' when the navigation reached the site.
 */
export function navigationRefusal(message, finalUrl) {
  if (EDGE_REFUSALS.some((code) => message.includes(code))) return 'ip_blocked';
  if (
    PROXY_FAILURES.some((code) => message.includes(code)) ||
    finalUrl.startsWith('chrome-error://')
  )
    return 'proxy_failed';
  return 'reached';
}
