// Putting the account's signed-in cookies into an action's session. The jar
// is admitted only through the freshness gate (`../auth/cookie-freshness.mjs`);
// of its cookies, those the site the action opens would be sent (RFC 6265
// domain-match against that site's host) are added. A stale jar, or one
// holding nothing for that site, is answered by the platform's inline
// relogin when the action has one; otherwise it is the run's checkpoint.
// The localStorage the account's last session saved for that site's origins
// goes back with the cookies, so session headers that refer to it match.

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
 * Put the localStorage the account's session saved for origins on
 * `siteHost`'s site back into every page of that origin, before its own
 * scripts read it; answers how many entries are restored. A page that
 * refuses an entry throws inside that page.
 */
async function restoreSiteStorage(s, acct, siteHost) {
  const origins = acct.metadata?.storage_state?.origins;
  const saved = Array.isArray(origins)
    ? origins.filter(
        (o) =>
          URL.canParse(o?.origin) &&
          Array.isArray(o.localStorage) &&
          sentTo({ domain: new URL(o.origin).hostname }, siteHost),
      )
    : [];
  for (const { origin, localStorage: items } of saved)
    await s.ctx.addInitScript(
      ({ origin: own, entries }) => {
        if (location.origin !== own) return;
        for (const { name, value } of entries)
          window.localStorage.setItem(name, value);
      },
      { origin, entries: items },
    );
  return saved.flatMap((o) => o.localStorage).length;
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
    const restored = await restoreSiteStorage(s, acct, siteHost);
    console.log(
      `[${label}] injected ${cookies.length} ${siteHost} cookies and ${restored} stored localStorage entries (jar fresh)`,
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
