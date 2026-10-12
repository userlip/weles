import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { detectTikTokBanSignals } from '../../../../dist/platforms/tiktok/ban_signals.js';

const INDENT = '  ';

/** TikTok refused the sign-in: its own answer, as the run's failure. */
export function refusedLogin(diag) {
  return Object.assign(
    new Error(`TIKTOK_LOGIN_REFUSED: ${JSON.stringify(diag.refusal)}`),
    { code: 'TIKTOK_LOGIN_REFUSED' },
  );
}

/** Chromium's own network error codes, by what each says about the route. */
const NET_ERRORS = {
  ERR_HTTP_RESPONSE_CODE_FAILURE: 'ip_blocked',
  ERR_BLOCKED_BY_RESPONSE: 'ip_blocked',
  ERR_BLOCKED_BY_CLIENT: 'ip_blocked',
  ERR_BLOCKED_BY_ADMINISTRATOR: 'ip_blocked',
  ERR_TUNNEL_CONNECTION_FAILED: 'proxy_failed',
  ERR_PROXY_CONNECTION_FAILED: 'proxy_failed',
};

/** TikTok's own pages a stopped sign-in lands on, by path. */
const STOPPED_AT = [
  { path: /^\/login\/download-app|\/captcha/, signal: 'captcha_challenge' },
  { path: /^\/login/, signal: 'checkpoint' },
];

/**
 * Classify a failed login from what said it failed: TikTok's own answer to
 * its login call (read by the TikTok ban detector's declared rules), the
 * captcha the run could not pass (its own captcha_challenge code), Chromium's
 * network error code, or the TikTok page it stopped on.
 */
export async function classifyLoginFailure(error, page, loginDiag) {
  const message = String(error?.message);
  const finalUrl = page.url();
  if (error?.code === 'TIKTOK_LOGIN_REFUSED') {
    const signal = await detectTikTokBanSignals(page, loginDiag.loginResponses);
    return signal.healthy ? 'action_failed' : signal.signal;
  }
  if (message.startsWith('captcha_challenge:')) return 'captcha_challenge';
  const netError = /\bnet::(?<code>ERR_[A-Z_]+)/.exec(message);
  if (netError && Object.hasOwn(NET_ERRORS, netError.groups.code))
    return NET_ERRORS[netError.groups.code];
  if (finalUrl.startsWith('chrome-error://')) return 'proxy_failed';
  const path = new URL(finalUrl).pathname;
  const stopped = STOPPED_AT.find((step) => step.path.test(path));
  return stopped ? stopped.signal : 'action_failed';
}

/**
 * Persist the login diagnostics and a structured ban_signal so the worker
 * reads the classified reason instead of 'unknown_error'.
 */
export async function recordLoginFailure(error, s, acct, loginDiag) {
  const dir = runRecordingsDir('tiktok_login');
  mkdirSync(dir, { recursive: true });
  const finalUrl = s.page.url();
  const message = String(error?.message);
  const ts = new Date().toISOString();
  writeFileSync(
    join(dir, 'login_diag.json'),
    JSON.stringify(
      { ...loginDiag, error: message, final_url: finalUrl, ts },
      null,
      INDENT,
    ),
  );
  const signal = await classifyLoginFailure(error, s.page, loginDiag);
  writeFileSync(
    join(dir, 'ban_signal.json'),
    JSON.stringify(
      {
        account_id: acct.id,
        username: acct.username,
        action: 'tiktok_login',
        signal,
        healthy: false,
        details: { final_url: finalUrl, reason: message },
        ts,
      },
      null,
      INDENT,
    ),
  );
}
