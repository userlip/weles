/**
 * LinkedIn signup on dedicated ISP proxies.
 *
 * This trajectory does not attempt to solve or bypass CAPTCHA/checkpoint
 * challenges. It records those states as detection failures so operators do
 * not get false PASS signals from blocked registrations.
 *
 * The run itself lives here: session start, proxy validation, the walk to the
 * signup form, and the verdict kept at the end through the shared verdict
 * writer, with the stages the run passed and the diagnostics of the live
 * session. A failure is thrown. The steps it is made of live in ./register/.
 */
import { WSession } from '../../../dist/session/wsession.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import {
  assertLinkedinDedicatedIspProxy,
  assertLinkedinProxyStable,
  assertLinkedinRegisterProxyRequest,
  assertNoLinkedinChallengePage,
  classifyLinkedinRegisterFailure,
  getLinkedinFailureDiagnostics,
} from '../_shared/linkedin/signup/register_guard.mjs';
import { keepVerdict } from '../_shared/action/verdict.mjs';
import {
  HEADLESS,
  STOP_AFTER_SIGNUP_READY,
  earlyFingerprintCheck,
  guestPrewarmUrls,
  registerBrowser,
  registerOs,
  registerPersona,
  replayWarmProfile,
  requestedEntryUrl,
  requestedProxy,
  safeRequestedProxy,
  sessionProxy,
  warmManifest,
  warmProfileDir,
} from './register/run_request.mjs';
import {
  enterLinkedinSignup,
  prewarmLinkedinGuestSession,
} from './register/signup_entry.mjs';
import { hashValue, writeSubmitDiagnostics } from './register/diagnostics.mjs';
import {
  linkedinFailureReasons,
  loadProxyPreflightSummary,
} from './register/refusal.mjs';
import { createLinkedinAccount } from './register/account_creation.mjs';

const LABEL = 'linkedin_register';
let s = null;
let id;
// The exit IP every later proxy check is measured against. Held in one place so
// the stage log and the account-creation steps always read the same value.
const proxyWatch = { expectedExitIp: undefined };
const stageEvents = [];

/** One stage the run passed, with the proxy state the session reports then. */
function recordStage(stage, data) {
  const proxy = s ? s.proxyConfig : undefined;
  stageEvents.push({
    ts: new Date().toISOString(),
    stage,
    url: s ? s.page.url() : undefined,
    expected_exit_ip: proxyWatch.expectedExitIp,
    actual_exit_ip: proxy?.exit_ip,
    proxy_type: proxy?.proxy_type,
    provider: proxy?.provider,
    country: proxy?.country,
    platform: proxy?.platform,
    ...data,
  });
}

console.log(`[register] proxy request: ${safeRequestedProxy(requestedProxy)}`);
console.log(`[register] entry url: ${requestedEntryUrl}`);
if (guestPrewarmUrls.length)
  console.log(`[register] guest prewarm urls: ${guestPrewarmUrls.length}`);
if (warmProfileDir)
  console.log(`[register] warm profile dir: ${warmProfileDir}`);
if (warmManifest)
  console.log('[register] warm manifest loaded: persona+proxy replay enabled');

let verdict;
let failure;
try {
  recordStage('proxy_request_received', {
    requested_proxy: safeRequestedProxy(requestedProxy),
  });
  assertLinkedinRegisterProxyRequest(requestedProxy);
  recordStage('proxy_request_validated', {
    requested_proxy: safeRequestedProxy(requestedProxy),
  });
  s = await WSession.start({
    label: LABEL,
    proxy: sessionProxy,
    targetHost: 'www.linkedin.com',
    platform: 'linkedin',
    browser: registerBrowser,
    os: registerOs,
    persona: registerPersona,
    headless: HEADLESS,
    userDataDir: warmProfileDir ? warmProfileDir : undefined,
  });
  await replayWarmProfile(s);
  recordStage('session_started');
  await earlyFingerprintCheck(s);
  recordStage('early_fingerprint_ok');
  id = {
    first: s.identity.firstName,
    last: s.identity.lastName,
    handle: s.identity.username,
    email: s.identity.email,
    password: s.identity.password,
  };
  proxyWatch.expectedExitIp = s.proxyConfig?.exit_ip;
  recordStage('identity_ready', {
    identity_created: true,
    email_hash: hashValue(id.email),
    handle_hash: hashValue(id.handle),
  });
  assertLinkedinDedicatedIspProxy(s, requestedProxy);
  recordStage('proxy_metadata_validated');
  if (await prewarmLinkedinGuestSession(s, guestPrewarmUrls))
    recordStage('guest_prewarm_complete', { urls: guestPrewarmUrls.length });
  await enterLinkedinSignup(s, requestedEntryUrl);
  recordStage('signup_goto_complete', { entry_url: requestedEntryUrl });
  if (STOP_AFTER_SIGNUP_READY) {
    // An observed run asked to stop at the signup form: nothing is registered
    // and no verdict on the account is reached.
    await writeSubmitDiagnostics('entry_path_stop_after_signup_ready', {
      url: s.page.url(),
      entry_url: requestedEntryUrl,
    });
    console.log('[register] LINKEDIN_REGISTER_STOP_AFTER_SIGNUP_READY reached');
  } else {
    await pageSettled(s.page);
    proxyWatch.expectedExitIp = await assertLinkedinProxyStable(
      s,
      'after_goto',
      proxyWatch.expectedExitIp,
    );
    recordStage('proxy_stable_after_goto');
    await assertNoLinkedinChallengePage(s, 'after_goto');
    recordStage('no_challenge_after_goto');
    const authState = await createLinkedinAccount({
      session: s,
      identity: id,
      recordStage,
      proxyWatch,
    });
    recordStage('pass');
    verdict = {
      signal: 'healthy',
      healthy: true,
      details: {
        username_hash: hashValue(id.handle),
        email_hash: hashValue(id.email),
        final_url: s.page.url(),
        auth: authState,
        diagnostics: await getLinkedinFailureDiagnostics(
          s,
          requestedProxy,
          proxyWatch.expectedExitIp,
        ),
        failure_reasons: [],
        stage_events: stageEvents,
      },
    };
    console.log(`PASS: ${id.handle}`);
  }
} catch (error) {
  failure = error;
  const finalUrl = s ? s.page.url() : undefined;
  const signal = classifyLinkedinRegisterFailure(error.message, finalUrl);
  recordStage('failure_classified', { signal, error: error.message });
  let diagnostics = {
    proxy: {
      requested: safeRequestedProxy(requestedProxy),
      preflight: loadProxyPreflightSummary(),
    },
  };
  if (s) {
    let unread;
    try {
      diagnostics = await getLinkedinFailureDiagnostics(
        s,
        requestedProxy,
        proxyWatch.expectedExitIp,
      );
    } catch (diagnosticsError) {
      unread = diagnosticsError;
    }
    if (unread)
      diagnostics = {
        collected: false,
        reason: `failure diagnostics could not be read off the live session: ${unread.message}`,
      };
  }
  verdict = {
    signal,
    healthy: false,
    details: {
      final_url: finalUrl,
      error: error.message,
      attempted_email_hash: id ? hashValue(id.email) : null,
      expected_exit_ip: proxyWatch.expectedExitIp,
      diagnostics,
      failure_reasons: linkedinFailureReasons(
        signal,
        error.message,
        finalUrl,
        diagnostics,
      ),
      stage_events: stageEvents,
    },
  };
  console.log(`FAIL: ${error.message}`);
} finally {
  // The browser closes before the run ends, so Playwright flushes the
  // recording to disk.
  if (s) await s.close();
}
if (verdict) {
  try {
    await keepVerdict(LABEL, null, verdict);
  } catch (keepError) {
    failure = failure
      ? new AggregateError(
          [failure, keepError],
          `${failure.message}; and its verdict was not kept: ${keepError.message}`,
        )
      : keepError;
  }
}
if (failure) throw failure;
