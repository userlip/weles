// What a LinkedIn login ended as, and the browser it leaves behind.
import { spawnSync } from 'node:child_process';
import { navigationRefusal } from '../../_shared/page/navigation/refused.mjs';
import { onCheckpointRoute, onSignInPage } from '../../_shared/linkedin/sign_in.mjs';

/**
 * The verdict of a submitted login with no li_at cookie: a checkpoint
 * LinkedIn still holds it at, a proxy that never carried the request, or a
 * bounce back to the login page (credentials refused, or a session redirect
 * loop). Every one of them but the proxy is a checkpoint, which marks the
 * account's cookies stale when the verdict is kept.
 */
export function unsignedVerdict(finalUrl) {
  if (onCheckpointRoute(finalUrl))
    return {
      signal: 'checkpoint',
      healthy: false,
      details: { final_url: finalUrl, reason: 'LinkedIn holds the login at its checkpoint after the captcha solver ran' },
    };
  if (finalUrl.startsWith('chrome-error://'))
    return {
      signal: 'proxy_failed',
      healthy: false,
      details: { final_url: finalUrl, reason: 'the proxy did not carry the login' },
    };
  return {
    signal: 'checkpoint',
    healthy: false,
    details: {
      final_url: finalUrl,
      reason: onSignInPage(finalUrl)
        ? 'submit returned to /login: credentials refused or a session redirect loop'
        : 'no li_at cookie set after submit',
    },
  };
}

/**
 * The verdict of a login that threw: an edge refusal or a proxy that never
 * carried the request, read from Chromium's own error; a page that ended on
 * a checkpoint route; otherwise unknown.
 */
export function failedVerdict(message, finalUrl) {
  const refusal = navigationRefusal(message, finalUrl);
  const signal =
    refusal !== 'reached' ? refusal : onCheckpointRoute(finalUrl) ? 'checkpoint' : 'unknown_error';
  return { signal, healthy: false, details: { final_url: finalUrl, error: message } };
}

/** The weles-fp-* tag the session's browser was launched with, if it has one. */
export function currentWelesFingerprintTag(s) {
  const args = s.ctx._welesBrowserProvenance?.launch_args;
  if (!Array.isArray(args)) return undefined;
  const fingerprint = args.map(String).find((arg) => arg.startsWith('--weles-fingerprint='));
  return fingerprint?.match(/weles-fp-[^/]+/)?.shift();
}

/**
 * End whatever the tagged browser left running. A tag no process carries is
 * nothing to end; a pkill that fails says why.
 */
export function reapWelesFingerprintTag(tag) {
  if (!tag) return;
  const found = spawnSync('pgrep', ['-f', tag], { encoding: 'utf8' });
  if (found.error) throw new Error(`pgrep -f ${tag} did not run: ${found.error.message}`);
  if (!found.stdout.trim()) return;
  const ended = spawnSync('pkill', ['-f', tag], { encoding: 'utf8' });
  if (ended.error || ended.status)
    throw new Error(`pkill -f ${tag} failed: ${ended.error ? ended.error.message : ended.stderr}`);
}
