import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { markCookiesStale } from '../../../../dist/utils/credentials.js';
import { navigationRefusal } from '../../_shared/page/navigation/refused.mjs';

export const CHECKPOINT_RE = /\/(checkpoint|uas\/login|login\/recovery)/;

/** Persist the ban_signal the worker reads for this account and run. */
export function writeBan(acct, signal, details) {
  try {
    const dir = runRecordingsDir('linkedin_login');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'ban_signal.json'),
      JSON.stringify(
        {
          account_id: acct.id,
          username: acct.username,
          action: 'linkedin_login',
          signal,
          healthy: signal === 'healthy',
          details: details ?? {},
          ts: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (e) {
    console.log(`[linkedin_login] ban_signal not written: ${e.message}`);
  }
}

/** Record the failure and mark the stored cookies stale so routine cron stops re-attempting a dead account. */
export async function markStaleAndFail(
  acct,
  reason,
  finalUrl,
  signal = 'checkpoint',
) {
  writeBan(acct, signal, { final_url: finalUrl, reason });
  if (acct.id) await markCookiesStale(acct.id);
}

/**
 * Classify a thrown login error. An edge refusal must read as ip_blocked so
 * worker-pool auto-markBurned fires; a proxy that never carried the request
 * is proxy_failed; a page that ended on a checkpoint route is checkpoint.
 */
export function classifyLoginError(message, finalUrl) {
  const refusal = navigationRefusal(message, finalUrl);
  if (refusal !== 'reached') return refusal;
  if (CHECKPOINT_RE.test(finalUrl)) return 'checkpoint';
  return 'unknown_error';
}

/** The weles-fp-* tag the browser was launched with, so its processes can be reaped after close. */
export function currentWelesFingerprintTag(s) {
  try {
    const args = s?.ctx?._welesBrowserProvenance?.launch_args || [];
    const fpArg = args.find((arg) =>
      String(arg).startsWith('--weles-fingerprint='),
    );
    const match = String(fpArg || '').match(/weles-fp-[^/]+/);
    return match?.[0] || false;
  } catch {
    return false;
  }
}

/** Kill whatever the tagged browser left behind; nothing to reap is not an error. */
export function reapWelesFingerprintTag(tag) {
  if (!tag) return;
  try {
    execFileSync('pkill', ['-f', tag], { stdio: 'ignore' });
  } catch {}
}
