// What the run does when the pool has nothing left to scan with: it starts the
// Pangram register trajectory as a child process with a run of its own, tells
// from that child's exit whether an account was created, and keeps a daily
// register ledger of every run. How many accounts may be registered in a day
// is the caller's budget, stated in PANGRAM_MAX_AUTO_REGISTERS. A registration
// that does not produce an account stays a failed registration carrying its
// own reason.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { todayKey } from './usage_ledger.mjs';
import { statedBudget } from '../../../_shared/inputs/stated.mjs';

// Under the user's home unless PANGRAM_AUTO_REGISTER_LEDGER_FILE names it:
// the working directory gave every run started elsewhere a fresh ledger,
// and with it a fresh daily registration budget.
function autoRegisterLedgerPath() {
  return (
    process.env.PANGRAM_AUTO_REGISTER_LEDGER_FILE ??
    join(homedir(), '.weles', 'pangram-auto-register.json')
  );
}

// A ledger that does not exist is an empty one. Any other read failure, or a
// file that is not a ledger object, is refused with its path.
export function readAutoRegisterLedger() {
  const path = autoRegisterLedgerPath();
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`cannot read the Pangram auto-register ledger ${path}: ${error.message}`);
  }
  const ledger = JSON.parse(text);
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger))
    throw new Error(`the Pangram auto-register ledger ${path} is not a ledger object`);
  return ledger;
}

function writeAutoRegisterLedger(ledger) {
  const path = autoRegisterLedgerPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, ' '));
}

export function maxAutoRegisters() {
  return statedBudget(
    'PANGRAM_MAX_AUTO_REGISTERS',
    'how many Pangram accounts auto-registration may create in a day',
  );
}

/** Today's registration runs in `ledger`. */
function runsToday(ledger) {
  const day = ledger[todayKey()];
  return day ? day.runs : [];
}

export function autoRegisterCountToday(ledger) {
  return runsToday(ledger).length;
}

/** Runs the register trajectory once, recording the run; answers whether it created an account. */
function runRegisterChild(script, reason, mode, ledger) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const runId = `pangram-auto-register-${randomUUID()}`;
  // The register trajectory's DIAG switch dumps the form and exits without
  // registering, so the child never inherits it.
  const { DIAG: _diagnosticDump, ...inherited } = process.env;
  const child = spawn(process.execPath, [script], {
    env: {
      ...inherited,
      PANGRAM_AUTO_REGISTER_RUN: '1',
      WELES_RUN_ID: runId,
      ACTION: `pangram_auto_register_${mode}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.on('error', reject);
  child.on('close', (code, signal) => {
    // The register trajectory exits with no failure status only once its
    // account is saved.
    const success = !code && signal === null;
    const day = todayKey();
    if (!Object.hasOwn(ledger, day)) ledger[day] = { runs: [] };
    ledger[day].runs.push({
      run_id: runId,
      reason,
      mode,
      success,
      exitCode: code,
      signal,
      ts: new Date().toISOString(),
    });
    writeAutoRegisterLedger(ledger);
    resolve({
      success,
      reason: success ? 'registered' : `register_failed: run ${runId} exit ${code} signal ${signal}`,
      stdout,
      stderr,
      ledgerDay: ledger[day],
    });
  });
  return promise;
}

export async function autoRegisterPangramAccount(reason) {
  const ledger = readAutoRegisterLedger();
  const limit = maxAutoRegisters();
  const todayCount = autoRegisterCountToday(ledger);
  if (todayCount >= limit)
    return { success: false, reason: `daily_auto_register_limit ${todayCount}/${limit}` };
  // Beside this module, not under whatever directory the run started from.
  const script =
    process.env.PANGRAM_REGISTER_SCRIPT ?? join(import.meta.dirname, '..', '..', 'register.mjs');
  if (!existsSync(script)) return { success: false, reason: `register_script_not_found: ${script}` };
  return runRegisterChild(script, reason, 'proxy', ledger);
}
