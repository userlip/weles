// The daily Pangram usage ledger: for each UTC day, each account's scans and
// whether Pangram itself said the account has no credits left. The account
// choice (pool_rotation.mjs) reads exactly what the recording writes here,
// so the two can never disagree about what an exhausted account means.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Today's ledger key: the UTC calendar date. */
export function todayKey() {
  const [day] = new Date().toISOString().split('T');
  return day;
}

// The ledger key of one account. An account with neither an id nor a
// username is refused: every such account would share one ledger entry, and
// one exhausted account would read as all of them exhausted.
export function accountKey(acct) {
  const key = acct.id ? acct.id : acct.username;
  if (!key)
    throw new Error(
      'pangram_account_unidentified: an account in the pool has neither an id nor a username',
    );
  return String(key);
}

/** The mail domain of the account's address, or null when it states none. */
export function accountDomain(acct) {
  const address = acct.metadata?.email ? acct.metadata.email : acct.username;
  const domain = String(address).toLowerCase().match(/@(?<domain>[^>\s]+)/)?.groups.domain;
  return domain ? domain : null;
}

// Under the user's home unless PANGRAM_ACCOUNT_USAGE_FILE names the ledger:
// the working directory gave every run started elsewhere an empty ledger,
// so exhausted accounts read as fresh.
function usageLedgerPath() {
  return (
    process.env.PANGRAM_ACCOUNT_USAGE_FILE ??
    join(homedir(), '.weles', 'pangram-account-usage.json')
  );
}

// A ledger that does not exist is an empty one. Any other read failure, or a
// file that is not a ledger object, is refused with its path.
export function readUsageLedger() {
  const path = usageLedgerPath();
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`cannot read the Pangram account usage ledger ${path}: ${error.message}`);
  }
  const ledger = JSON.parse(text);
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger))
    throw new Error(`the Pangram account usage ledger ${path} is not a ledger object`);
  return ledger;
}

function writeUsageLedger(ledger) {
  const path = usageLedgerPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, ' '));
}

/** Today's entry of `acct`, or undefined when it has not scanned today. */
export function todaysEntry(ledger, acct) {
  return ledger[todayKey()]?.[accountKey(acct)];
}

// An account is out for the day when Pangram itself said it has no credits
// left (markAccountExhausted); no per-account scan count is chosen here.
export function exhaustedToday(ledger, acct) {
  return todaysEntry(ledger, acct)?.exhausted === true;
}

/** How many scans `acct` ran today. */
export function scansToday(ledger, acct) {
  const entry = todaysEntry(ledger, acct);
  return entry ? entry.scan_attempts : Number();
}

/** Today's entry of `acct` in `ledger`, created empty when it has none yet. */
function entryToWrite(ledger, acct) {
  const day = todayKey();
  if (!Object.hasOwn(ledger, day)) ledger[day] = {};
  const key = accountKey(acct);
  if (!Object.hasOwn(ledger[day], key)) ledger[day][key] = { scan_attempts: Number() };
  const entry = ledger[day][key];
  Object.assign(entry, {
    account_id: acct.id,
    username: acct.username,
    domain: accountDomain(acct),
  });
  return entry;
}

/** Records one scan by `acct` of the input `stats` describes; answers the account's entry for today. */
export function recordAccountUse(acct, stats, pool) {
  const ledger = readUsageLedger();
  const entry = entryToWrite(ledger, acct);
  entry.scan_attempts++;
  Object.assign(entry, {
    last_input_sha256: stats.sha256,
    last_used_at: new Date().toISOString(),
    pool_available_before_run: pool.available_count,
  });
  writeUsageLedger(ledger);
  return entry;
}

/** Records that Pangram said `acct` has no credits left today, with its reason and credit state. */
export function markAccountExhausted(acct, stats, pool, reason, creditState) {
  const ledger = readUsageLedger();
  const entry = entryToWrite(ledger, acct);
  Object.assign(entry, {
    exhausted: true,
    exhausted_reason: reason,
    credit_state: creditState,
    last_input_sha256: stats.sha256,
    last_used_at: new Date().toISOString(),
    pool_available_before_run: pool.available_count,
  });
  writeUsageLedger(ledger);
  return entry;
}
