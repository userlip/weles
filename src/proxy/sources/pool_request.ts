// A pool-style proxy request ("residential oxylabs us") read word by word:
// its pool type is the word the declared pool types parse (proxyTypeOf), its
// country the first two-letter word that is a region in Unicode's region
// registry (UK reads as GB), and its provider the word that names a provider
// proxy/capability.ts declares. A word none of these read is ignored; a proxy
// URL is not a pool request.
import { ALL_PROVIDERS } from '../capability.js';
import { proxyTypeOf, type ProxyType } from './provider_credentials.js';

export interface PoolRequest {
  proxyType: ProxyType | undefined;
  country: string | undefined;
  provider: string | undefined;
}

const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

/** The region `word` names in Unicode's region registry, or undefined when it names none. */
function region(word: string): string | undefined {
  if (!/^[a-z][a-z]$/i.test(word)) return undefined;
  const canonical = new Intl.Locale('und', { region: word.toUpperCase() }).region;
  return canonical && REGION_NAMES.of(canonical) ? canonical : undefined;
}

export function poolRequest(request: string): PoolRequest {
  const words = request.toLowerCase().split(/\s+/).filter(Boolean);
  return {
    proxyType: words.map(proxyTypeOf).find(Boolean),
    country: words.map(region).find(Boolean),
    provider: ALL_PROVIDERS.find((name) => words.includes(name)),
  };
}
