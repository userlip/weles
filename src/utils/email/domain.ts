import { resolveMx } from 'node:dns/promises';
import { readSetting, writeSetting } from '../../state/skarbiec-records.js';

// A domain is used until a platform is observed blocking it (reportBlocked);
// no count of signups per domain is chosen here. Picks go to the least-used
// active domain, so signups spread on their own.
const DOMAIN_STATE_KEY = 'inbound_email_domains';

export type DomainRow = {
  domain: string;
  status: 'active' | 'pending' | 'mx_broken';
  signup_count: number;
  block_count?: number;
  last_used_at?: string;
  last_block_at?: string;
  registered_at?: string;
  mx_configured_at?: string;
  resend_verified_at?: string | null;
  provider?: string;
  metadata?: Record<string, any>;
  updated_at?: string;
};

/** The recorded inbound domains; none recorded is an empty list, and a record that is not a list is refused. */
export function readDomainRows(): DomainRow[] {
  const rows = readSetting<unknown>(DOMAIN_STATE_KEY, []);
  if (!Array.isArray(rows)) {
    throw new Error(
      `Weles setting ${DOMAIN_STATE_KEY} holds ${JSON.stringify(rows)}, not a list of domains`,
    );
  }
  return rows as DomainRow[];
}

export function writeDomainRows(rows: DomainRow[]): void {
  writeSetting(DOMAIN_STATE_KEY, rows);
}

/** A resolver failure is a broken MX until the next check, logged with its cause. */
function mxUnreadable(domain: string, error: unknown): boolean {
  const cause =
    (error as NodeJS.ErrnoException).code ?? (error as Error).message;
  console.log(`[email] mx_lookup_failed: ${domain}: ${cause}`);
  return false;
}

// Asked on every pick; the resolver's own record TTL decides how long an
// answer is reused, not a window chosen here.
async function hasValidMx(domain: string): Promise<boolean> {
  try {
    return Boolean((await resolveMx(domain)).length);
  } catch (error) {
    return mxUnreadable(domain, error);
  }
}

/** A domain from AGENT_EMAIL_DOMAINS, or AGENT_DOMAIN; with neither stated, no domain is assumed. */
function envDerived(): string {
  const listed = process.env.AGENT_EMAIL_DOMAINS;
  if (listed) {
    const domains = listed
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    if (domains.length)
      return domains[Math.floor(Math.random() * domains.length)];
  }
  const single = process.env.AGENT_DOMAIN?.trim();
  if (single) return single;
  throw new Error(
    'no inbound email domain is recorded and none of FORCE_EMAIL_DOMAIN, AGENT_EMAIL_DOMAINS or AGENT_DOMAIN is set; no domain is assumed',
  );
}

function platformBlock(row: DomainRow, platform?: string): boolean {
  if (!platform) return false;
  const key = platform.toLowerCase();
  const metadata = row.metadata;
  if (!metadata) return false;
  return Boolean(
    metadata.platform_blocks?.[key] || metadata.blocked_platforms?.[key],
  );
}

/** The time the domain was last picked; a domain never picked sorts before any that was. */
function lastUsed(row: DomainRow): string {
  if (row.last_used_at) return row.last_used_at;
  return '';
}

async function pickStoredDomain(platform?: string): Promise<string | null> {
  const rows = readDomainRows();
  const now = new Date().toISOString();
  let changed = false;
  for (const row of rows.filter(
    (candidate) => candidate.status === 'mx_broken',
  )) {
    if (await hasValidMx(row.domain)) {
      row.status = 'active';
      row.updated_at = now;
      changed = true;
    }
  }
  const candidates = rows
    .filter((row) => row.status === 'active' && !platformBlock(row, platform))
    .sort(
      (left, right) =>
        left.signup_count - right.signup_count ||
        lastUsed(left).localeCompare(lastUsed(right)),
    );
  for (const row of candidates) {
    if (!(await hasValidMx(row.domain))) {
      row.status = 'mx_broken';
      row.updated_at = now;
      changed = true;
      continue;
    }
    row.last_used_at = now;
    writeDomainRows(rows);
    return row.domain;
  }
  if (changed) writeDomainRows(rows);
  if (platform && rows.length)
    throw new Error(
      `domain_unavailable: every inbound domain is broken or blocked for ${platform}`,
    );
  return null;
}

export async function pickDomain(platform?: string): Promise<string> {
  const forced = process.env.FORCE_EMAIL_DOMAIN?.trim();
  if (forced) return forced;
  const stored = await pickStoredDomain(platform);
  if (stored) return stored;
  return envDerived();
}

function domainOf(emailOrDomain: string): string {
  const [local, domain] = emailOrDomain.split('@');
  if (domain) return domain;
  return local;
}

export async function markSignupSuccess(
  emailOrDomain: string,
  platform?: string,
): Promise<void> {
  const domain = domainOf(emailOrDomain);
  const rows = readDomainRows();
  const row = rows.find((candidate) => candidate.domain === domain);
  if (!row) return;
  const now = new Date().toISOString();
  row.signup_count++;
  row.last_used_at = now;
  row.updated_at = now;
  if (platform) {
    row.metadata = {
      ...row.metadata,
      platform_success: {
        ...row.metadata?.platform_success,
        [platform.toLowerCase()]: now,
      },
    };
  }
  writeDomainRows(rows);
}

/** Records that a platform blocked the domain, with the reason the platform gave. */
export async function reportBlocked(
  domainOrEmail: string,
  reason: string,
  platform?: string,
): Promise<void> {
  const domain = domainOf(domainOrEmail);
  const rows = readDomainRows();
  const row = rows.find((candidate) => candidate.domain === domain);
  if (!row) return;
  const now = new Date().toISOString();
  if (!row.block_count) row.block_count = Number();
  row.block_count++;
  row.last_block_at = now;
  row.updated_at = now;
  row.metadata = { ...row.metadata, last_block_reason: reason };
  if (platform) {
    row.metadata.platform_blocks = {
      ...row.metadata.platform_blocks,
      [platform.toLowerCase()]: { reason, at: now },
    };
  }
  writeDomainRows(rows);
}
