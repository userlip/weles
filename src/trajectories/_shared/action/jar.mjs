// Putting the account's signed-in cookies into an action's session. The jar
// is admitted only through the freshness gate (`../auth/cookie-freshness.mjs`);
// of its cookies, those the site the action opens would be sent (RFC 6265
// domain-match against that site's host) are added. A stale jar, or one
// holding nothing for that site, is answered by the platform's inline
// relogin when the action has one; otherwise it is the run's checkpoint.

import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../auth/cookie-freshness.mjs';

/** Whether a browser would send `cookie` to `host`. */
function sentTo(cookie, host) {
  const domain = cookie.domain.replace(/^\./, '');
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Add the account's fresh cookies for `siteHost` to the session. Resolves
 * null when the session holds a signed-in jar (or the inline relogin minted
 * one), or `{ banSignal, failure }` when the jar is stale and nothing
 * refreshed it: the caller throws `failure` inside its own try, so its
 * verdict is persisted and the session closed. Any other failure, including
 * a refused cookie injection, is thrown.
 */
export async function admitAccountJar({
  s,
  cfg,
  acct,
  label,
  proxyUrl,
  persona,
  siteHost,
}) {
  let stale;
  try {
    const cookies = loadFreshCookieJarOrFail(acct, {
      platform: cfg.platform,
      label,
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    }).filter((cookie) => sentTo(cookie, siteHost));
    if (!cookies.length)
      throw new CookieJarStaleError(
        `cookie_jar_no_domain_match: the fresh jar holds no cookie ${siteHost} would be sent`,
        { platform: cfg.platform, reason: 'no_domain_match' },
      );
    await s.ctx.addCookies(cookies);
    console.log(
      `[${label}] injected ${cookies.length} ${siteHost} cookies (jar fresh)`,
    );
    return null;
  } catch (error) {
    if (!(error instanceof CookieJarStaleError)) throw error;
    stale = error;
  }
  if (typeof cfg.inlineRelogin !== 'function')
    return {
      banSignal: {
        signal: 'checkpoint',
        healthy: false,
        details: { reason: stale.message, ...stale.details },
      },
      failure: stale,
    };
  console.log(`[${label}] ${stale.message} — attempting inline relogin`);
  let relogin;
  let reloginError;
  try {
    relogin = await cfg.inlineRelogin(s, acct);
  } catch (error) {
    reloginError = error;
  }
  if (relogin?.ok) {
    console.log(`[${label}] inline relogin minted fresh cookies — continuing`);
    return null;
  }
  const why = reloginError
    ? reloginError.message
    : relogin?.reason
      ? relogin.reason
      : 'the relogin returned no reason';
  return {
    banSignal: {
      signal: 'checkpoint',
      healthy: false,
      details: {
        reason: `${stale.message} (inline relogin failed: ${why})`,
        ...stale.details,
      },
    },
    failure: stale,
  };
}
