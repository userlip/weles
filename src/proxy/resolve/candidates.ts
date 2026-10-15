// Which provider rows a proxy request is tried against, in what order: the
// Skarbiec proxy records plus the static ISP rows, narrowed by the pool type
// and provider the request names (../sources/pool_request.ts), shuffled
// unless static. A row's provider is derived from its endpoint and its pool
// type is what the row declares (`proxy_type` in its Skarbiec context); a row
// that declares no pool type cannot answer a typed request and is returned
// under `undeclared` so the resolver reports it instead of guessing.
import type { WelesServiceSecret } from '../../secrets/scoped-service.js';
import { listServiceMetadata } from '../../state/skarbiec-records.js';
import { providerFromHost } from '../policy.js';
import { poolRequest } from '../sources/pool_request.js';
import { proxyTypeOf, type ProxyType } from '../sources/provider_credentials.js';

export type ProviderRow = {
  display_name: string;
  proxy_host: string;
  proxy_port: string;
  provider?: string;
  proxy_type?: ProxyType;
  secret_service?: WelesServiceSecret;
  // The balance the row's record states; absent when it states none.
  balance_usd?: number;
  metadata?: { country?: string };
};

export type ProviderCandidates = {
  candidates: ProviderRow[];
  undeclared: ProviderRow[];
  // 'unknown' when the request names no pool type: every row is tried.
  proxyType: ProxyType | 'unknown';
  ccOverride: string | undefined;
};

/** The rows in a random order, each order equally likely. */
function shuffled(rows: ProviderRow[]): ProviderRow[] {
  return rows
    .map((row) => ({ row, key: Math.random() }))
    .sort((left, right) => left.key - right.key)
    .map(({ row }) => row);
}

export async function providerCandidates(proxy: string): Promise<ProviderCandidates> {
  const providers: ProviderRow[] = listServiceMetadata('proxy')
    .filter((record) => record.host && record.port)
    .map(
      (record): ProviderRow => ({
        display_name: String(record.display_name ?? record.id),
        proxy_host: String(record.host),
        proxy_port: String(record.port),
        provider: typeof record.provider === 'string' ? record.provider : providerFromHost(String(record.host)),
        proxy_type: proxyTypeOf(record.proxy_type),
        ...(typeof record.balance_usd === 'number' ? { balance_usd: record.balance_usd } : {}),
        metadata:
          record.metadata && typeof record.metadata === 'object' ? (record.metadata as { country?: string }) : undefined,
      }),
    );
  // Decodo first — canonical static ISP (real residential ASNs). The ISP
  // branch below keeps this order deterministic.
  const { maybeOxylabsIspRow, maybeOxylabsDedicatedIspRow, maybeDecodoIspRows } = await import('../sources/isp_row.js');
  for (const r of [...maybeDecodoIspRows(), maybeOxylabsIspRow(), maybeOxylabsDedicatedIspRow()]) if (r) providers.push(r);

  // The request's country overrides the row's stored country
  // ('residential us', 'residential br').
  const request = poolRequest(proxy);
  const proxyType = request.proxyType ? request.proxyType : 'unknown';
  const undeclared = request.proxyType ? providers.filter((p) => !p.proxy_type) : [];
  const typed = request.proxyType ? providers.filter((p) => p.proxy_type === request.proxyType) : providers;
  // Explicit provider targeting, e.g. 'pingproxies residential': the names
  // are the ones `proxy/capability.ts` declares, matched against the
  // provider the row's endpoint derives.
  const filtered = request.provider ? typed.filter((p) => p.provider === request.provider) : typed;
  // Residential and mobile pools are shuffled (per-pool rate limits); ISP rows stay in order.
  const ordered = proxyType === 'isp' ? filtered : shuffled(filtered);
  const ccOverride = request.country ? request.country.toLowerCase() : undefined;
  return { candidates: ordered, undeclared, proxyType, ccOverride };
}
