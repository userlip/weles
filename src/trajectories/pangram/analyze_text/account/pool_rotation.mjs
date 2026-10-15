// Which vault account performs this scan. The pool is every Pangram account
// in Skarbiec (or the one ACCOUNT_ID names), minus those Pangram said are out
// of credits today, least-used first and newest first among equals, read
// from the same daily ledger the recording writes (usage_ledger.mjs). An
// account that cannot scan now is a named rejection, never a swallowed error.
import {
  getSocialAccount,
  markCookiesStale,
  resolveAccountSession,
} from '../../../../../dist/utils/credentials.js';
import { LABEL } from '../scan_brief.mjs';
import {
  CookieJarStaleError,
  loadFreshCookieJarOrFail,
} from '../../../_shared/auth/cookie-freshness.mjs';
import { listAccounts } from '../../../_shared/skarbiec/accounts.mjs';
import { statedCount } from '../../../_shared/inputs/stated.mjs';
import {
  accountDomain,
  accountKey,
  exhaustedToday,
  readUsageLedger,
  scansToday,
} from './usage_ledger.mjs';

/** How many accounts of the pool have each mail domain. */
function domainSummary(accounts) {
  const counts = {};
  for (const acct of accounts) {
    const domain = accountDomain(acct);
    const name = domain === null ? 'without_email_domain' : domain;
    counts[name] = Object.hasOwn(counts, name) ? counts[name] : Number();
    counts[name]++;
  }
  return counts;
}

// Every account is considered unless the run caps the pool itself.
function activePangramAccounts() {
  const accounts = listAccounts('pangram');
  const accountId = process.env.ACCOUNT_ID?.trim();
  const selected = accountId ? accounts.filter((account) => account.id === accountId) : accounts;
  const limit =
    process.env.PANGRAM_ACCOUNT_POOL_LIMIT === undefined
      ? selected.length
      : statedCount('PANGRAM_ACCOUNT_POOL_LIMIT', 'how many Pangram accounts the rotation considers');
  return selected.slice(Number(), limit).map((account) => ({
    ...account,
    created_at: account.document.context?.created_at,
  }));
}

function createdAtMillis(acct) {
  if (!acct.created_at) return null;
  const parsed = Date.parse(acct.created_at);
  if (Number.isNaN(parsed))
    throw new Error(
      `pangram_account_created_at_unreadable account=${accountKey(acct)} value=${String(acct.created_at)}`,
    );
  return parsed;
}

// Least scans today first; among equals the newest account, and an account
// whose creation is unrecorded after every dated one.
function byUsage(ledger) {
  return (a, b) => {
    const usage = scansToday(ledger, a) - scansToday(ledger, b);
    if (usage) return usage;
    const createdA = createdAtMillis(a);
    const createdB = createdAtMillis(b);
    const undated = (createdA === null) - (createdB === null);
    if (undated || createdA === null) return undated;
    return createdB - createdA;
  };
}

/** The account the run uses with its fresh session, or why it cannot scan now. */
async function prepare(acct) {
  const sessionOpts = await resolveAccountSession(acct);
  const cookies = loadFreshCookieJarOrFail(acct, {
    platform: 'pangram',
    label: LABEL,
    currentProxyUrl: sessionOpts.proxyUrl,
    currentPersona: sessionOpts.persona,
  });
  return { sessionOpts, cookies };
}

/** Why `acct` cannot scan now: a stale jar is flagged on the account; any other failure is the run's. */
async function rejection(acct, error) {
  if (!(error instanceof CookieJarStaleError)) throw error;
  if (acct.id) {
    try {
      await markCookiesStale(acct.id);
    } catch (markError) {
      throw new Error(
        `pangram account ${accountKey(acct)} cannot scan: ${error.message}; and its cookie jar stayed unmarked: ${markError.message}`,
        { cause: error },
      );
    }
  }
  return { account_id: acct.id, username: acct.username, reason: error.details.reason };
}

async function selectSingleConfiguredAccount() {
  const acct = await getSocialAccount('pangram');
  if (!acct) return { account: null, reason: 'no_account', pool: { available_count: Number(), total_accounts: Number() } };
  const accounts = [acct];
  return {
    account: acct,
    ...(await prepare(acct)),
    reason: null,
    pool: { available_count: accounts.length, total_accounts: accounts.length },
  };
}

export async function selectPangramAccountForRun() {
  if (process.env.PANGRAM_ACCOUNT_ROTATION === '0') return selectSingleConfiguredAccount();

  const accounts = activePangramAccounts();
  const ledger = readUsageLedger();
  const available = accounts.filter((acct) => !exhaustedToday(ledger, acct));
  const ordered = [...available].sort(byUsage(ledger));
  const rejected = [];

  for (const acct of ordered) {
    let prepared;
    try {
      prepared = await prepare(acct);
    } catch (error) {
      rejected.push(await rejection(acct, error));
      continue;
    }
    return {
      account: acct,
      ...prepared,
      reason: null,
      pool: {
        total_accounts: accounts.length,
        available_count: ordered.length,
        rejected_count: rejected.length,
        selected_usage_before_run: scansToday(ledger, acct),
        domains: domainSummary(accounts),
      },
    };
  }

  let reason = 'no_fresh_account';
  if (!accounts.length) reason = 'no_account';
  else if (!available.length) reason = 'quota_exhausted';
  return {
    account: null,
    reason,
    pool: {
      total_accounts: accounts.length,
      available_count: ordered.length,
      exhausted_by_pangram: accounts.length - available.length,
      rejected_count: rejected.length,
      rejected_accounts: rejected,
      domains: domainSummary(accounts),
    },
  };
}
