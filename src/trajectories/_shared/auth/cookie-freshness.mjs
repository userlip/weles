// Cookie-jar freshness gate — second line of defense after auth-probe.mjs.
//
// Stored cookies alone do not prove an authenticated session. Providers can
// bind them to the device and connection that established the session and
// return a logged-out shell without redirecting. auth-probe.mjs catches the
// symptom (no signed-in marker on the page). This module catches what can
// be known before injecting: a jar no verified login minted, or one minted
// under another proxy or persona, is not injected; the caller marks the
// cookies stale, which the routine layer turns into a fresh login on its
// next pass. How long a platform honours a session is the platform's:
// expired cookies are dropped by the browser itself and a revoked session is
// what auth-probe.mjs observes.
//
//   persistFreshCookieJar(acct, cookies, binding)
//       Called by a login once the login is verified signed in. Stamps
//       metadata.cookies and metadata.cookies_minted_at, with the proxy and
//       persona the jar was minted under, so actions know a verified login
//       minted it. Outside WSession.saveAccount (the register flow) this is
//       the only writer of cookies_minted_at.
//
//   loadFreshCookieJarOrFail(acct, { platform, label, ... })
//       Called by an action before injecting cookies. Throws
//       CookieJarStaleError when the jar is empty, was not stamped by a
//       verified login, or was minted under another proxy or persona.

import { providerFromHost } from '../../../../dist/proxy/policy.js';
import { updateAccountMetadata } from '../skarbiec/accounts.mjs';

export class CookieJarStaleError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'CookieJarStaleError';
    this.details = details;
  }
}

/**
 * The egress a jar is bound to: the proxy provider and port when the proxy's
 * username names its provider (a provider's gateway host can change between
 * connections of one session, its username shape does not), else its host
 * and port; 'direct' without a proxy. Accepts a ProxyConfig ({ host, port,
 * username }) or a proxy URL.
 */
export function proxySignature(proxy) {
  if (!proxy) return 'direct';
  const parsed = typeof proxy === 'string' ? new URL(proxy) : undefined;
  const host = parsed ? parsed.hostname : proxy.host;
  const port = parsed ? parsed.port : String(proxy.port);
  const username = parsed ? decodeURIComponent(parsed.username) : proxy.username;
  const provider = providerFromHost(undefined, username);
  return [provider ? provider : host, port].filter(Boolean).join(':');
}

/**
 * The persona a jar is bound to: its canvas seed, which every generated
 * persona carries and keeps in metadata.persona. A persona without one cannot
 * be told from another and is refused.
 */
export function personaSignature(persona) {
  if (persona.canvasSeed === undefined || persona.canvasSeed === null)
    throw new Error('COOKIE_PERSONA_UNSIGNED: the persona carries no canvas seed to bind a cookie jar to');
  return `cs:${persona.canvasSeed}`;
}

/** The signature a stored stamp holds: stamps are written as signature strings; an older object stamp is signed now. */
function storedSignature(stamp, sign) {
  if (typeof stamp === 'string') return stamp;
  return sign(stamp);
}

function stale(code, message, details) {
  return new CookieJarStaleError(`${code}: ${message} — login required`, details);
}

/**
 * The stored cookie jar of `acct`, once it is known to be minted by a
 * verified login under the proxy and persona about to inject it.
 *
 * currentProxyUrl and currentPersona are the account session's (resolve
 * them with resolveAccountSession); skipBindingCheck is for a run that has no
 * session context of its own to compare (a probe).
 */
export function loadFreshCookieJarOrFail(acct, { platform, label, currentProxyUrl, currentPersona, skipBindingCheck }) {
  const metadata = acct.metadata;
  const base = { platform, label, account_id: acct.id };
  const cookies = Array.isArray(metadata.cookies) ? metadata.cookies : [];
  if (!cookies.length)
    throw stale('cookie_jar_empty', `no cookies stored for ${platform}/${acct.username}`, { ...base, reason: 'empty' });
  const mintedAt = metadata.cookies_minted_at;
  if (!mintedAt)
    throw stale('cookie_jar_unstamped', 'no cookies_minted_at: no verified login minted this jar', {
      ...base,
      reason: 'no_minted_at',
    });
  if (!Number.isFinite(Date.parse(mintedAt)))
    throw stale('cookie_jar_bad_mint_ts', `cookies_minted_at=${mintedAt} is not a timestamp`, {
      ...base,
      reason: 'bad_minted_at',
      mintedAtRaw: mintedAt,
    });
  if (skipBindingCheck) return cookies;
  // A jar minted under another proxy or persona is refused by the platform's
  // own session binding (a signed-out shell, no redirect), so it is not
  // injected at all.
  if (metadata.cookies_minted_proxy && currentProxyUrl) {
    const stored = storedSignature(metadata.cookies_minted_proxy, proxySignature);
    const current = proxySignature(currentProxyUrl);
    if (stored !== 'direct' && current !== 'direct' && stored !== current)
      throw stale('cookie_jar_proxy_mismatch', `jar minted under proxy=${stored} but current proxy=${current} for ${platform}`, {
        ...base,
        reason: 'proxy_mismatch',
        stored_proxy: stored,
        current_proxy: current,
      });
  }
  if (metadata.cookies_minted_persona && currentPersona) {
    const stored = storedSignature(metadata.cookies_minted_persona, personaSignature);
    const current = personaSignature(currentPersona);
    if (stored !== current)
      throw stale('cookie_jar_persona_mismatch', `jar minted under persona=${stored} but current persona=${current} for ${platform}`, {
        ...base,
        reason: 'persona_mismatch',
        stored_persona: stored,
        current_persona: current,
      });
  }
  return cookies;
}

/** The stamp of what minted the jar: the session's own, else the account's recorded one; null when there is neither. */
function mintingStamp(current, recorded, sign) {
  if (current) return sign(current);
  if (recorded) return sign(recorded);
  return null;
}

/** The proxy record a minting proxy URL becomes; refused when the URL does not parse. */
function proxyRecord(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port),
    protocol: parsed.protocol.replace(/:$/, ''),
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

/**
 * Keep a freshly minted cookie jar in the account's Skarbiec record, stamped
 * with when, and under which proxy and persona, it was minted; with
 * persistProxy the minting proxy also becomes the account's proxy. Only a
 * login that has just verified the session is signed in may call this: the
 * stamp is the proof a fresh login happened. Answers { ok: false, reason }
 * for an account that has no Skarbiec record; a record that refuses the
 * write throws with Skarbiec's own cause.
 */
export async function persistFreshCookieJar(acct, cookies, binding) {
  if (!acct.id) return { ok: false, reason: 'no_skarbiec_account_id' };
  const { currentProxyUrl, currentPersona, persistProxy } = binding ? binding : {};
  const now = new Date().toISOString();
  const nextMetadata = {
    ...acct.metadata,
    cookies,
    cookies_updated_at: now,
    cookies_minted_at: now,
    cookies_minted_proxy: mintingStamp(currentProxyUrl, acct.metadata.proxy, proxySignature),
    cookies_minted_persona: mintingStamp(currentPersona, acct.metadata.persona, personaSignature),
  };
  if (persistProxy && typeof currentProxyUrl === 'string') nextMetadata.proxy = proxyRecord(currentProxyUrl);
  // Fresh cookies are no longer stale; the account selectors skip an account
  // whose stale mark is newer than its minted cookies.
  delete nextMetadata.cookies_stale_at;
  updateAccountMetadata(acct.id, nextMetadata);
  // The in-memory account sees the fresh stamp without another read.
  acct.metadata = nextMetadata;
  return { ok: true, minted_at: now };
}
