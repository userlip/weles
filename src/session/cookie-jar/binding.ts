// What a stored cookie jar is bound to: the egress and the persona that
// minted it. Providers bind a session to the device and connection that
// established it, so a jar is only injected under the same signatures. The
// register flow (WSession.saveAccount), the logins that persist a fresh jar
// and the actions that check one before injecting all sign through here.
import { providerFromHost } from '../../proxy/policy.js';

/** A proxy as Weles holds it: a proxy URL, a stored record, or a browser proxy setting. */
export type ProxyBinding =
  | string
  | { host: string; port: number | string; username?: string }
  | { server: string; username?: string };

/** A persona as generated: every generated persona carries a canvas seed. */
export interface PersonaBinding {
  canvasSeed?: number | string | null;
}

function endpoint(proxy: ProxyBinding): { host: string; port: string; username: string | undefined } {
  if (typeof proxy === 'string') {
    const url = new URL(proxy);
    return { host: url.hostname, port: url.port, username: decodeURIComponent(url.username) };
  }
  if ('server' in proxy) {
    const url = new URL(proxy.server);
    return { host: url.hostname, port: url.port, username: proxy.username };
  }
  return { host: proxy.host, port: String(proxy.port), username: proxy.username };
}

/**
 * The egress a jar is bound to: the proxy provider and port when the proxy's
 * username names its provider (a provider's gateway host can change
 * between connections of one session, its username shape does not), else
 * its host and port; 'direct' without a proxy.
 */
export function proxySignature(proxy: ProxyBinding | null | undefined): string {
  if (!proxy) return 'direct';
  const { host, port, username } = endpoint(proxy);
  const provider = providerFromHost(undefined, username);
  return [provider ? provider : host, port].filter(Boolean).join(':');
}

/** The persona a jar is bound to: its canvas seed. A persona without one cannot be told from another and is refused. */
export function personaSignature(persona: PersonaBinding): string {
  if (persona.canvasSeed === undefined || persona.canvasSeed === null)
    throw new Error('COOKIE_PERSONA_UNSIGNED: the persona carries no canvas seed to bind a cookie jar to');
  return `cs:${persona.canvasSeed}`;
}
