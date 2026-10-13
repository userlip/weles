// The chosen account's Pangram cookies, put into the browser context the
// scan runs in. A jar holding no pangram.com cookie is stale, not empty.

import { LABEL } from '../scan_brief.mjs';
import {
  CookieJarStaleError,
  loadFreshCookieJarOrFail,
} from '../../../_shared/auth/cookie-freshness.mjs';

export async function injectCookies(s, acct, sessionOpts, preloadedCookies) {
  const cookies = preloadedCookies
    ? preloadedCookies
    : loadFreshCookieJarOrFail(acct, {
        platform: 'pangram',
        label: LABEL,
        currentProxyUrl: sessionOpts.proxyUrl,
        currentPersona: sessionOpts.persona,
      });
  const wanted = cookies.filter(
    (c) => typeof c.domain === 'string' && c.domain.includes('pangram.com'),
  );
  if (!wanted.length)
    throw new CookieJarStaleError(
      'cookie_jar_no_domain_match: no pangram.com cookies',
      {
        platform: 'pangram',
        label: LABEL,
        reason: 'no_domain_match',
        account_id: acct && acct.id ? acct.id : null,
      },
    );
  await s.ctx.addCookies(wanted);
  return wanted.length;
}
