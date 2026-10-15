// Signing a platform's account in through another platform's OAuth button
// ("Continue with Google", "Sign in with Apple", ...), end to end:
//   1. the provider account's stored cookies, put on the provider's domains
//   2. the target's login page, and its provider control, found by the vision
//      model in whatever language the target renders (behind the target's
//      own sign-in control when its login address shows the homepage)
//   3. the provider's consent screen
//   4. the redirect back to the target's domain
//   5. assertAuthed for the target platform
//   6. the target's cookies kept with persistFreshCookieJar
// The outcome is kept as the run's verdict through the shared verdict
// writer; a failure is thrown.

import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  injectProviderCookies,
  handleOAuthConsent,
  waitForNavBackTo,
} from '../../../../dist/platforms/_shared/cross_platform_oauth.js';
import { clickOffered } from '../page/judged/seen.mjs';
import { assertAuthed, AuthProbeError } from '../auth/auth-probe.mjs';
import { persistFreshCookieJar } from '../auth/cookie-freshness.mjs';
import { pageSettled } from '../page/settled.mjs';
import { keepVerdict } from '../action/verdict.mjs';

// The providers' own sign-in hosts: a page still on one has not come back.
const PROVIDER_HOSTS = [
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com',
  'login.microsoft.com',
  'live.com',
  'facebook.com/dialog',
  'api.twitter.com/oauth',
  'twitter.com/i/oauth2',
  'x.com/i/oauth2',
  'github.com/login/oauth',
  'instagram.com/oauth',
];

/** A refusal before any session, kept as the run's verdict, then thrown. */
async function refuse(label, signal, message) {
  const failure = new Error(`${signal}: ${message}`);
  await keepVerdict(label, null, { signal, healthy: false, details: { reason: message } });
  throw failure;
}

/** The provider's account, read without the target account the worker pinned. */
async function providerAccount(provider) {
  // ACCOUNT_ID names the target's account; the provider's is another one.
  const pinnedTarget = process.env.ACCOUNT_ID;
  delete process.env.ACCOUNT_ID;
  try {
    return await getSocialAccount(provider);
  } finally {
    if (pinnedTarget !== undefined) process.env.ACCOUNT_ID = pinnedTarget;
  }
}

export async function runCrossLogin(opts) {
  const { targetPlatform, targetUrl, provider } = opts;
  const label = `${targetPlatform}_login_via_${provider}`;
  const acct = await getSocialAccount(targetPlatform);
  if (!acct) await refuse(label, 'no_target_account', `no active ${targetPlatform} account in Skarbiec`);
  const providerAcct = await providerAccount(provider);
  if (!providerAcct)
    await refuse(label, 'provider_account_missing', `no active ${provider} account in Skarbiec`);
  const providerCookies = Array.isArray(providerAcct.metadata?.cookies) ? providerAcct.metadata.cookies : [];
  if (!providerCookies.length)
    await refuse(
      label,
      'provider_cookies_missing',
      `${provider} account ${providerAcct.username} holds no cookies; sign the provider in first`,
    );
  console.log(
    `[cross-login] target=${targetPlatform}/${acct.username} provider=${provider}/${providerAcct.username}`,
  );

  const { proxyUrl, persona } = await resolveAccountSession(acct);
  const s = await WSession.start({ label, proxy: proxyUrl, persona });
  let banSignal;
  let failure;
  try {
    const injected = await injectProviderCookies(s.ctx, provider, providerCookies);
    console.log(`[cross-login] injected ${injected} ${provider} cookies`);
    await s.goto(targetUrl);
    await pageSettled(s.page);
    // Some targets show their homepage at the login address and open the SSO
    // choices only after their own sign-in control is clicked.
    const providerControl = `the button that signs in or continues with ${provider} (an account on ${provider}, not another provider)`;
    let offered = await clickOffered(s.page, providerControl);
    if (!offered && (await clickOffered(s.page, "the control that opens the site's own sign-in"))) {
      await pageSettled(s.page);
      offered = await clickOffered(s.page, providerControl);
    }
    if (!offered) {
      banSignal = { signal: 'provider_button_not_found', healthy: false, details: { final_url: s.page.url(), provider } };
      throw new Error(`provider_button_not_found: ${s.page.url()} offers no sign-in with ${provider}`);
    }
    await pageSettled(s.page);
    await handleOAuthConsent(s);
    const targetHost = new URL(targetUrl).hostname.replace(/^www\./, '');
    await waitForNavBackTo(s.page, targetHost, PROVIDER_HOSTS);
    let unauthed;
    try {
      await assertAuthed(targetPlatform, s, { label });
    } catch (error) {
      unauthed = error;
    }
    if (unauthed) {
      banSignal =
        unauthed instanceof AuthProbeError
          ? unauthed.banSignal
          : { signal: 'assert_authed_failed', healthy: false, details: { reason: unauthed.message, final_url: s.page.url() } };
      throw unauthed;
    }
    const cookies = await s.ctx.cookies();
    const persisted = await persistFreshCookieJar(acct, cookies, {
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
    if (!persisted.ok) {
      banSignal = { signal: 'cookies_persist_failed', healthy: false, details: { reason: persisted.reason } };
      throw new Error(`cookies_persist_failed: ${persisted.reason}`);
    }
    banSignal = {
      signal: 'healthy',
      healthy: true,
      details: { provider, final_url: s.page.url(), cookies_persisted: cookies.length },
    };
    console.log(`PASS: ${targetPlatform} logged in via ${provider} (${cookies.length} cookies persisted)`);
  } catch (error) {
    failure = error;
    if (!banSignal)
      banSignal = { signal: 'action_failed', healthy: false, details: { reason: error.message, final_url: s.page.url() } };
    console.log('FAIL:', error.message);
  } finally {
    try {
      await keepVerdict(label, acct, { ...banSignal, provider });
    } catch (keepError) {
      failure = failure
        ? new AggregateError([failure, keepError], `${failure.message}; and its verdict was not kept: ${keepError.message}`)
        : keepError;
    }
    await s.close();
  }
  if (failure) throw failure;
}
