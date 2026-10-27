/**
 * Every way this run learns that LinkedIn caught it — the proxy preflight
 * verdict it inherited, the challenge page it was handed, the CAPTCHA still
 * standing on screen — plus the vocabulary those blocks are reported under.
 * The run never solves a challenge; it names it and stops.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { writeSubmitDiagnostics } from './diagnostics.mjs';
import { CAPTCHA_FRAME_HOSTS } from '../../_shared/linkedin/signup/register_guard/page_state.mjs';

/**
 * What the proxy preflight of this run found, redacted: null when the run
 * had none; a preflight record that is not JSON throws.
 */
export function loadProxyPreflightSummary() {
  const path = join(
    runRecordingsDir('linkedin_register'),
    'proxy_preflight.json',
  );
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const attempts = Array.isArray(raw.attempts) ? raw.attempts : [];
  const countBy = (key) =>
    Object.fromEntries(
      Object.entries(
        Object.groupBy(attempts, (attempt) => String(attempt[key])),
      ).map(([value, matching]) => [value, matching.length]),
    );
  return {
    selected: raw.selected === true,
    selected_provider: raw.selected_provider,
    failure_reason: raw.failure_reason,
    attempt_count:
      raw.attempt_count === undefined ? attempts.length : raw.attempt_count,
    linkedin_probe_results: countBy('linkedin_probe_result'),
    rejected_reasons: countBy('rejected_reason'),
    exit_ip_hashes: [
      ...new Set(
        attempts.map((attempt) => attempt.exit_ip_hash).filter(Boolean),
      ),
    ],
    redacted: true,
  };
}

/**
 * Open the challenge LinkedIn handed the signup and record what it shows
 * (its inputs, controls and frames), naming its kind from that structure: a
 * phone or one-time-code field, a captcha provider's frame, or LinkedIn's
 * checkpoint route and challenge frame. A challenge page that cannot be read
 * is recorded with the error that stopped it.
 */
export async function inspectCreateAccountChallenge(session, challengeUrl) {
  const out = {
    challenge_url: new URL(
      challengeUrl,
      'https://www.linkedin.com/',
    ).toString(),
    navigated: false,
    kind: 'challenge',
  };
  let unread;
  try {
    await session.page.goto(out.challenge_url, {
      waitUntil: 'domcontentloaded',
    });
    await pageSettled(session.page);
    Object.assign(
      out,
      await session.page.evaluate(() => {
        const visible = (el) => {
          const box = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          return (
            Boolean(box.width && box.height) &&
            style.visibility !== 'hidden' &&
            style.display !== 'none'
          );
        };
        return {
          navigated: true,
          url: location.href,
          title: document.title,
          page_key: document
            .querySelector('meta[name="pageKey"]')
            ?.getAttribute('content'),
          body_text_sample: document.body.innerText.replace(/\s+/g, ' ').trim(),
          inputs: Array.from(document.querySelectorAll('input'), (input) => ({
            id: input.id,
            name: input.name,
            type: input.type,
            autocomplete: input.getAttribute('autocomplete'),
            visible: visible(input),
          })),
          buttons: Array.from(document.querySelectorAll('button,a'))
            .filter(visible)
            .map((el) => ({
              tag: el.tagName.toLowerCase(),
              text: el.textContent.replace(/\s+/g, ' ').trim(),
              href: el instanceof HTMLAnchorElement ? el.href : undefined,
            })),
          iframes: Array.from(document.querySelectorAll('iframe'), (frame) => ({
            id: frame.id,
            name: frame.name,
            title: frame.title,
            src: frame.src,
            visible: visible(frame),
          })),
        };
      }),
    );
  } catch (error) {
    unread = error;
  }
  if (unread) {
    out.error = unread.message;
    out.url = session.page.url();
  }
  const inputs = Array.isArray(out.inputs) ? out.inputs : [];
  const frames = Array.isArray(out.iframes)
    ? out.iframes.filter((frame) => frame.visible)
    : [];
  if (
    inputs.some(
      (input) => input.type === 'tel' || input.autocomplete === 'one-time-code',
    )
  )
    out.kind = 'phone_verification';
  else if (
    frames.some((frame) =>
      CAPTCHA_FRAME_HOSTS.some((host) => frame.src.includes(host)),
    )
  )
    out.kind = 'captcha_gauntlet';
  else if (
    [out.challenge_url, out.url].some((url) =>
      String(url).includes('/checkpoint'),
    ) ||
    frames.some((frame) => frame.src.includes('challengeIframe'))
  )
    out.kind = 'checkpoint_challenge';
  await writeSubmitDiagnostics('create_account_challenge_diagnostics', out);
  return out;
}

/**
 * Whether a captcha challenge stands on the page: LinkedIn's visible
 * challenge frame, a visible reCAPTCHA frame other than the invisible
 * enterprise anchor, or a visible reCAPTCHA widget or challenge dialog (the
 * reCAPTCHA badge is not one).
 */
export async function hasVisibleCaptchaChallenge(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Boolean(Number(style.opacity)) &&
        Boolean(box.width && box.height)
      );
    };
    const frame = Array.from(document.querySelectorAll('iframe')).some((f) => {
      if (f.src.includes('challengeIframe')) return visible(f);
      if (!/recaptcha/i.test(`${f.src} ${f.title}`)) return false;
      const invisibleAnchor =
        URL.canParse(f.src) &&
        new URL(f.src).pathname.includes('/recaptcha/enterprise/anchor') &&
        new URL(f.src).searchParams.get('size') === 'invisible';
      return !invisibleAnchor && visible(f);
    });
    const widget = Array.from(
      document.querySelectorAll(
        'div.g-recaptcha[data-sitekey], .challenge-dialog, #challenge-dialog',
      ),
    ).some((el) => visible(el) && !el.classList.contains('grecaptcha-badge'));
    return frame || widget;
  });
}

function addReason(reasons, code, message, data) {
  if (reasons.some((r) => r.code === code)) return;
  reasons.push({ code, message: String(message), ...data });
}

/**
 * The reasons a signup failed, each named once by its code: read from the
 * codes the run's own errors lead with, the signal, the address it ended on
 * and the diagnostics of the live session.
 */
export function linkedinFailureReasons(
  signal,
  errorMessage,
  finalUrl,
  diagnostics,
) {
  const message = String(errorMessage);
  const where = errorMessage ? errorMessage : finalUrl;
  const reasons = [];
  if (/PROXY_NOT_DEDICATED_ISP/.test(message))
    addReason(reasons, 'proxy_not_dedicated_isp', message);
  if (/PROXY_DRIFT_CHECK_FAILED/.test(message))
    addReason(reasons, 'proxy_drift_probe_failed', message);
  if (/PROXY_DRIFT:/.test(message))
    addReason(reasons, 'proxy_exit_ip_drift', message);
  if (/DETECTION_TRIGGERED/.test(message) || signal === 'captcha_challenge')
    addReason(reasons, 'linkedin_challenge_or_checkpoint', where);
  if (
    /PHONE_VERIFICATION_REQUIRED/.test(message) ||
    signal === 'phone_verification_required'
  )
    addReason(reasons, 'phone_verification_required', where);
  if (/signup_form_unavailable/.test(message))
    addReason(reasons, 'signup_form_unavailable', message);
  if (/entry_path_no_signup_click/.test(message))
    addReason(reasons, 'entry_path_no_signup_click', message);
  if (/entry_path_no_signup_transition/.test(message))
    addReason(reasons, 'entry_path_no_signup_transition', message);
  if (
    /signup_did_not_complete/.test(message) ||
    /^https?:\/\/www\.linkedin\.com\/signup\/?$/.test(String(finalUrl))
  )
    addReason(reasons, 'signup_did_not_complete', where);
  if (/signup_verification_incomplete/.test(message))
    addReason(reasons, 'signup_verification_incomplete', message);
  if (/signup_did_not_authenticate/.test(message))
    addReason(reasons, 'missing_authenticated_session', message);
  if (/ACCOUNT_PERSIST_FAILED/.test(message))
    addReason(reasons, 'account_persist_failed', message);
  if (diagnostics?.challenge_signal)
    addReason(
      reasons,
      'linkedin_page_challenge_signal',
      diagnostics.challenge_signal,
    );
  if (
    diagnostics?.auth &&
    diagnostics.auth.has_li_at === false &&
    signal !== 'proxy_failed'
  )
    addReason(
      reasons,
      'missing_li_at_cookie',
      `linkedin_cookie_count=${diagnostics.auth.linkedin_cookie_count}`,
    );
  if (!reasons.length)
    addReason(reasons, signal ? signal : 'action_failed', where);
  return reasons;
}
