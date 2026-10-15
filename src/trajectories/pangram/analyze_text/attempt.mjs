// One attempt at a Pangram analysis: an account from the pool (or none, for
// Pangram's public checker), its session, the text scanned, the result read
// from Pangram's own answer. Answers the attempt's outcome: its verdict, the
// account and usage it ran with, and whether the run may try another account
// (only after Pangram answered that this one has no credits left).
import { WSession } from '../../../../dist/session/wsession.js';
import { detectPangramBanSignals } from '../../../../dist/platforms/pangram/ban_signals.js';
import { CookieJarStaleError } from '../../_shared/auth/cookie-freshness.mjs';
import { banSignalOf } from '../../_shared/auth/ban-signal.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { LABEL, RESULT_FILE, mergeResult, writeJson } from './scan_brief.mjs';
import { authRequiredState, collectResult } from './verdict_reading.mjs';
import { clickAnalyze, dismissCookieBanner, fillInput, readVisibleCreditState } from './dashboard/scan_form.mjs';
import { waitForPublicVerificationIfNeeded } from './dashboard/human_verification.mjs';
import { injectCookies } from './account/cookies.mjs';
import { selectPangramAccountForRun } from './account/pool_rotation.mjs';
import { markAccountExhausted, recordAccountUse } from './account/usage_ledger.mjs';
import {
  autoRegisterCountToday,
  autoRegisterPangramAccount,
  maxAutoRegisters,
  readAutoRegisterLedger,
} from './account/auto_registration.mjs';

const AUTO_REGISTER = process.env.PANGRAM_AUTO_REGISTER === '1';

/** An account for this attempt: the pool's, one auto-registered when allowed, or none. */
async function attemptAccount(noAccount) {
  if (noAccount) return { account: null, reason: 'no_account_disabled', pool: null };
  let selection = await selectPangramAccountForRun();
  if (!selection.account && AUTO_REGISTER) {
    const registered = await autoRegisterPangramAccount(selection.reason);
    console.log(`[pangram:analyze_text] auto_register success=${registered.success} reason=${registered.reason}`);
    if (registered.success) selection = await selectPangramAccountForRun();
  }
  if (!selection.account && process.env.PANGRAM_REQUIRE_ACCOUNT === '1')
    throw Object.assign(new Error(`PANGRAM_ACCOUNT_REQUIRED: ${selection.reason}`), {
      banSignal: {
        signal: selection.reason === 'quota_exhausted' ? 'quota_exhausted' : 'no_account',
        healthy: false,
        details: {
          stage: 'pre-WSession',
          reason: selection.reason,
          account_pool: selection.pool,
          auto_register: AUTO_REGISTER
            ? { today_count: autoRegisterCountToday(readAutoRegisterLedger()), daily_limit: maxAutoRegisters() }
            : null,
        },
      },
    });
  return selection;
}

/** An unhealthy verdict thrown with the run's failure. */
function verdictError(message, banSignal) {
  return Object.assign(new Error(message), { banSignal });
}

export async function analyzeOnce({ text, stats, url, noAccount }) {
  const outcome = { acct: null, selection: null, usage: null, banSignal: null, retryAccount: false };
  let s;
  try {
    outcome.selection = await attemptAccount(noAccount);
    outcome.acct = outcome.selection.account;
    const sessionOpts = outcome.acct ? outcome.selection.sessionOpts : {};
    s = await WSession.start({
      label: LABEL,
      proxy: sessionOpts.proxyUrl,
      persona: sessionOpts.persona,
      targetHost: new URL(url).hostname,
      browser: 'chromium',
      os: process.env.WELES_FORCE_OS ? process.env.WELES_FORCE_OS : undefined,
    });
    let injectedCookies;
    if (outcome.acct) {
      let stale;
      try {
        injectedCookies = await injectCookies(s, outcome.acct, sessionOpts, outcome.selection.cookies);
      } catch (error) {
        if (!(error instanceof CookieJarStaleError)) throw error;
        stale = error;
      }
      if (stale)
        throw verdictError(stale.message, {
          signal: 'checkpoint',
          healthy: false,
          details: { reason: stale.message, ...stale.details },
        });
      outcome.usage = recordAccountUse(outcome.acct, stats, outcome.selection.pool);
      console.log(`[pangram:analyze_text] account=${outcome.acct.username} injected=${injectedCookies}`);
    }
    // allow-raw-playwright: public page navigation; WSession.goto can stall on screenshots
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(s.page);
    const inputSelector = await fillInput(s.page, text);
    await dismissCookieBanner(s.page);
    const credits = await readVisibleCreditState(s.page);
    if (outcome.acct && credits && !(Math.sign(credits.available) === Math.sign(Number.MAX_VALUE)))
      throw verdictError('pangram_insufficient_credits', {
        signal: 'insufficient_credits',
        healthy: false,
        details: { final_url: s.page.url(), account_id: outcome.acct.id, credit_state: credits },
      });
    if (!outcome.acct) {
      const verification = await waitForPublicVerificationIfNeeded(s.page);
      if (!verification.scanEnabled || !verification.turnstile) {
        const signal = verification.scanEnabled ? 'auth_required' : verification.turnstile ? 'captcha_required' : 'scan_disabled';
        throw verdictError(`pangram_public_${signal}`, {
          signal,
          healthy: false,
          details: { final_url: s.page.url(), verification },
        });
      }
    }
    const clicked = await clickAnalyze(s.page);
    await pageSettled(s.page);
    const result = await collectResult(s);
    const finalUrl = s.page.url();
    if (result.walled)
      throw verdictError(`pangram_${authRequiredState(finalUrl)}`, {
        signal: 'auth_required',
        healthy: false,
        details: { final_url: finalUrl, reason: authRequiredState(finalUrl), body_text_sample: result.body_text_sample },
      });
    outcome.banSignal = await banSignalOf(detectPangramBanSignals, s, 'after the scan');
    if (!outcome.banSignal.healthy)
      throw verdictError(`pangram_unhealthy:${outcome.banSignal.signal}`, outcome.banSignal);
    const out = mergeResult(
      {
        action: LABEL,
        final_url: finalUrl,
        input: stats,
        input_selector: inputSelector,
        clicked,
        injected_cookies: injectedCookies,
        captured_response_count: s.capturedResponses.length,
        account_pool: outcome.selection.pool,
        account_usage: outcome.usage,
        ts: new Date().toISOString(),
      },
      result,
    );
    writeJson(RESULT_FILE, out);
    console.log(`PASS: pangram_analyze_text ${out.verdict} source=${out.source}`);
    return outcome;
  } catch (error) {
    outcome.banSignal = error.banSignal
      ? error.banSignal
      : s
        ? await banSignalOf(detectPangramBanSignals, s, 'after the failure')
        : { signal: 'action_failed', healthy: false, details: { reason: error.message } };
    if (outcome.banSignal.healthy)
      outcome.banSignal = { signal: 'action_failed', healthy: false, details: { reason: error.message, final_url: s.page.url() } };
    if (outcome.banSignal.signal === 'insufficient_credits' && outcome.acct) {
      outcome.usage = markAccountExhausted(outcome.acct, stats, outcome.selection.pool, 'insufficient_credits', outcome.banSignal.details.credit_state);
      outcome.retryAccount = !noAccount;
      if (outcome.retryAccount && AUTO_REGISTER) await autoRegisterPangramAccount('insufficient_credits');
    }
    outcome.failure = error;
    console.log(`[ban-signal] ${outcome.banSignal.signal}  FAIL: ${error.message}`);
    return outcome;
  } finally {
    if (s) await s.close();
  }
}
