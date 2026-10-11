// IPv4 CIDR derivation + best-effort ASN lookup. Pure aside from the ASN
// network call, which is cached to ~/.weles/asn_cache.json so repeated
// burns on the same IP don't re-hit RIPEstat.
//
// Burn reputation aggregates at /19 + ASN for LinkedIn: createAccount
// challenges span several distinct /24s inside one ISP /19, so the /32 is
// never the discriminator.
// markBurnedIp records every level so isIpBurned can answer at whichever
// granularity the platform actually gates on.

import { homedir } from 'node:os';

// os.homedir(), not HOME with an empty default: an empty HOME put the cache
// at /.weles, where every write fails.
const ASN_CACHE_PATH = `${homedir()}/.weles/asn_cache.json`;

export function isIpv4(ip: string): boolean {
  return (
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip) &&
    ip.split('.').every((o) => Number(o) >= 0 && Number(o) <= 255)
  );
}

function ipToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function intToIp(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(
    '.',
  );
}

// Network address of `ip` masked to `bits` (e.g. maskCidr('135.132.89.213',19)
// === '135.132.64.0/19').
export function maskCidr(ip: string, bits: number): string {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return `${intToIp(ipToInt(ip) & mask)}/${bits}`;
}

export type CidrKeys = { ip32: string; cidr24: string; cidr19: string };

// The fixed-mask burn keys for an IP. ASN is resolved separately because
// it needs a network round-trip.
export function cidrKeys(ip: string): CidrKeys | undefined {
  if (!isIpv4(ip)) return undefined;
  return {
    ip32: `ip:${ip}`,
    cidr24: `net24:${maskCidr(ip, 24)}`,
    cidr19: `net19:${maskCidr(ip, 19)}`,
  };
}

type AsnCache = Record<string, { asn: string; at: string }>;

// The ASN cache; empty when there is none yet. One that cannot be read or is
// not a JSON object answers null after saying why, so a lookup does not save a
// one-entry cache over every ASN it held.
function loadAsnCache(): AsnCache | null {
  const { readFileSync, existsSync } = require('node:fs');
  if (!existsSync(ASN_CACHE_PATH)) return {};
  try {
    const j = JSON.parse(readFileSync(ASN_CACHE_PATH, 'utf8'));
    if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    console.error(
      `[proxy] ASN cache ${ASN_CACHE_PATH} is not a JSON object; it is not rewritten`,
    );
  } catch (error) {
    console.error(
      `[proxy] ASN cache ${ASN_CACHE_PATH} cannot be read, so it is not rewritten: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return null;
}

function saveAsnCache(c: AsnCache): void {
  try {
    const { mkdirSync, writeFileSync } = require('node:fs');
    const { dirname } = require('node:path');
    mkdirSync(dirname(ASN_CACHE_PATH), { recursive: true });
    writeFileSync(ASN_CACHE_PATH, JSON.stringify(c));
  } catch (error) {
    console.error(
      `[proxy] ASN cache ${ASN_CACHE_PATH} cannot be written, so the lookup repeats next time: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Resolve the origin ASN for an IP via RIPEstat. Cached forever per /32
// (ASN reassignment is rare and a stale ASN only mis-buckets one burn).
// Returns undefined on any failure — callers must treat ASN as optional.
export async function lookupAsn(ip: string): Promise<string | undefined> {
  if (!isIpv4(ip)) return undefined;
  const cache = loadAsnCache();
  if (cache?.[ip]?.asn) return cache[ip].asn;
  try {
    const r = await fetch(
      `https://stat.ripe.net/data/network-info/data.json?resource=${ip}`,
    );
    const j = (await r.json()) as { data?: { asns?: string[] } };
    const asn = j?.data?.asns?.[0];
    if (asn) {
      if (cache) {
        cache[ip] = { asn: String(asn), at: new Date().toISOString() };
        saveAsnCache(cache);
      }
      return String(asn);
    }
  } catch {
    /* network/parse failure → undefined */
  }
  return undefined;
}

// All burn keys for an IP including ASN (network call). The /32+/24+/19
// keys are always present for a valid IP; the asn key only when RIPEstat
// resolved.
export async function allBurnKeys(ip: string): Promise<string[]> {
  const ck = cidrKeys(ip);
  if (!ck) return [];
  const keys = [ck.ip32, ck.cidr24, ck.cidr19];
  const asn = await lookupAsn(ip);
  if (asn) keys.push(`asn:${asn}`);
  return keys;
}

// Append-only ledger of every LinkedIn (or other-platform) exit probe so
// clean-vs-dirty rate is a measured quantity over time, not an estimate.
// One JSONL line per probe: ts, platform, exit ip + its /24+/19, verdict,
// body bytes. Read with quality/cidr ledger consumers or jq. Bounded by
// nothing here (it is a diagnostic trail); rotate externally if needed.
export function recordProbe(
  platform: string,
  ip: string,
  result: string,
  bytes?: number,
): void {
  try {
    const { mkdirSync, appendFileSync } = require('node:fs');
    const { dirname } = require('node:path');
    const fp = `${homedir()}/.weles/linkedin_probe_ledger.jsonl`;
    mkdirSync(dirname(fp), { recursive: true });
    const ck = cidrKeys(ip);
    const row = {
      ts: new Date().toISOString(),
      platform: platform || '?',
      ip,
      net24: ck?.cidr24 ?? null,
      net19: ck?.cidr19 ?? null,
      result,
      bytes: bytes ?? null,
    };
    appendFileSync(fp, JSON.stringify(row) + '\n');
  } catch (error: unknown) {
    // The ledger is how the clean-versus-burned rate is measured; a lost row
    // is said, so a gap in the trail is not read as no probes.
    console.error(
      `[cidr] probe ledger write failed for ${ip}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
