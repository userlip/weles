// What the run does when the pool has nothing left to scan with: it starts the
// Pangram register trajectory as a child process, tells from that child's exit
// code and output whether an account was really created, and keeps a daily
// register ledger with the output tails as evidence. How many accounts may be
// registered in a day is the caller's budget, stated in
// PANGRAM_MAX_AUTO_REGISTERS. A registration that does not produce an account
// stays a failed registration carrying its own reason.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { todayKey } from './pool_rotation.mjs';
import { statedBudget } from '../../../_shared/inputs/stated.mjs';

// Under the user's home (HOME, else the user database): the working directory
// gave every run started elsewhere a fresh ledger, and with it a fresh daily
// registration budget.
function autoRegisterLedgerPath() {
  return (
    process.env.PANGRAM_AUTO_REGISTER_LEDGER_FILE ||
    join(homedir(), '.weles', 'pangram-auto-register.json')
  );
}

// A ledger that does not exist is an empty one. Any other read failure is
// thrown with its path: `existsSync` answers false for a ledger it cannot
// reach, and the day's registrations then counted from zero.
export function readAutoRegisterLedger() {
  const path = autoRegisterLedgerPath();
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(
      `cannot read the Pangram auto-register ledger ${path}: ${error.message}`,
    );
  }
  const parsed = JSON.parse(text);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function writeAutoRegisterLedger(ledger) {
  const path = autoRegisterLedgerPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(ledger, null, 2));
}

export function maxAutoRegisters() {
  return statedBudget(
    'PANGRAM_MAX_AUTO_REGISTERS',
    'how many Pangram accounts auto-registration may create in a day',
  );
}

export function autoRegisterCountToday(ledger) {
  return Number(ledger?.[todayKey()]?.count || 0);
}

async function runPangramRegisterChild(reason, mode) {
  const ledger = readAutoRegisterLedger();
  const limit = maxAutoRegisters();
  const todayCount = autoRegisterCountToday(ledger);
  if (todayCount >= limit) {
    return {
      success: false,
      reason: `daily_auto_register_limit ${todayCount}/${limit}`,
    };
  }

  // Beside this module, not under whatever directory the run started from.
  const script =
    process.env.PANGRAM_REGISTER_SCRIPT ||
    join(import.meta.dirname, '..', '..', 'register.mjs');
  if (!existsSync(script)) {
    return { success: false, reason: `register_script_not_found:${script}` };
  }

  const childEnv = {
    ...process.env,
    PANGRAM_AUTO_REGISTER_RUN: '1',
    WELES_RUN_ID:
      process.env.WELES_RUN_ID || `pangram-auto-register-${Date.now()}`,
    ACTION: `pangram_auto_register_${mode}_${Date.now()}`,
  };

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: childEnv,
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
    child.on('close', (code) => {
      const success =
        code === 0 && /PASS:\s*pangram account ready/i.test(stdout);
      ledger[todayKey()] = ledger[todayKey()] || { count: 0, runs: [] };
      ledger[todayKey()].count += 1;
      ledger[todayKey()].runs.push({
        reason,
        mode,
        success,
        exitCode: code,
        ts: new Date().toISOString(),
      });
      writeAutoRegisterLedger(ledger);
      resolve({
        success,
        reason: success ? 'registered' : `register_failed:${code}`,
        stdout,
        stderr,
        ledgerDay: ledger[todayKey()],
      });
    });
  });
}

export async function autoRegisterPangramAccount(reason) {
  return runPangramRegisterChild(reason, 'proxy');
}
