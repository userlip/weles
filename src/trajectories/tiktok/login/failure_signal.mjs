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

/** The captcha the run could not pass, as the run's failure. */
export function unpassedCaptcha(message) {
  return Object.assign(new Error(`captcha_challenge: ${message}`), {
    code: 'TIKTOK_CAPTCHA_UNPASSED',
    banSignal: {
      signal: 'captcha_challenge',
      healthy: false,
      details: { reason: message },
    },
  });
}

/** TikTok's own pages a stopped sign-in lands on, by path. */
const STOPPED_AT = [
  { path: /^\/login\/download-app|\/captcha/, signal: 'captcha_challenge' },
  { path: /^\/login/, signal: 'checkpoint' },
];

/**
 * Keep what the login saw (its passport answers, failed requests, captcha
 * and final state) in the run's login_diag.json, and attach to `error` the
 * verdict the failure itself names: TikTok's own refusal read by the TikTok
 * ban detector's declared rules, or the TikTok page the sign-in stopped on.
 * A failure that names none is left to the shared verdict, which reads the
 * page (and Chromium's error page) itself. Answers `error`.
 */
export async function explainLoginFailure(error, s, diag) {
  const finalUrl = s.page.url();
  const dir = runRecordingsDir('tiktok_login');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'login_diag.json'),
    JSON.stringify(
      {
        ...diag,
        error: error.message,
        final_url: finalUrl,
        ts: new Date().toISOString(),
      },
      null,
      INDENT,
    ),
  );
  if (error.banSignal) return error;
  const details = { final_url: finalUrl, reason: error.message };
  if (error.code === 'TIKTOK_LOGIN_REFUSED') {
    const read = await detectTikTokBanSignals(s.page, diag.loginResponses);
    if (!read.healthy) error.banSignal = read;
    return error;
  }
  if (!URL.canParse(finalUrl) || !finalUrl.startsWith('https:')) return error;
  const stopped = STOPPED_AT.find((step) =>
    step.path.test(new URL(finalUrl).pathname),
  );
  if (stopped)
    error.banSignal = { signal: stopped.signal, healthy: false, details };
  return error;
}
