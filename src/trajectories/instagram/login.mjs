import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { persistFreshCookieJar } from '../_shared/auth/cookie-freshness.mjs';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';
import { navigationRefusal } from '../_shared/page/navigation/refused.mjs';

const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
// Where Instagram sends an account it wants to verify, and one it has banned.
const CHECKPOINT_ROUTES = ['/challenge', '/checkpoint', '/two_factor'];
const SUSPENDED_ROUTES = ['/accounts/suspended', '/accounts/disabled'];

const acct = await getSocialAccount('instagram');
if (!acct) {
  console.log('FAIL: no active instagram account in DB');
  process.exitCode = 1;
}
process.env.SVC_EMAIL = acct.metadata.email ?? acct.username;
process.env.SVC_PASSWORD = acct.metadata.password ?? '';
console.log(`[trajectory] Using account: ${acct.username}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'instagram_login',
  proxy: proxyUrl,
  persona,
});

async function captureCookies() {
  if (!acct.id) return;
  try {
    const cookies = await s.ctx.cookies();
    await persistFreshCookieJar(acct, cookies, {
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
  } catch (e) {
    console.log('[cookie-capture] err:', e.message);
  }
}

try {
  // Cookie-first removed — cookies present + URL didn't bounce ≠ session is
  // authed. Instagram serves the same /-shell to logged-out users when the
  // injected sessionid is device-mismatched. Login always means form login
  // now; action trajectories use assertAuthed() to verify before acting.
  // Direct Playwright form login. Instagram inputs use name=username/password.
  await s.page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  // Instagram's actual selector names: email (not username) + pass (not
  // password). Earlier 'username'/'password' selectors never matched and
  // every login timed out at 30s before submit.
  const userIn = s.page
    .locator(
      'input[name="email"], input[name="username"], input[aria-label*="username" i], input[aria-label*="email" i]',
    )
    .filter({ visible: true })
    .first();
  const pwIn = s.page
    .locator(
      'input[name="pass"], input[name="password"], input[type="password"]',
    )
    .filter({ visible: true })
    .first();
  await userIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, userIn);
  await pageSettled(s.page);
  await humanType(s.page, process.env.SVC_EMAIL);
  await pageSettled(s.page);
  await humanClickLocator(s.page, pwIn);
  await pageSettled(s.page);
  await humanType(s.page, process.env.SVC_PASSWORD);
  await pageSettled(s.page);
  // Instagram's submit is a <div role="button"> with text "Log in" — there
  // are no <button type="submit"> elements rendered. Match exact text "Log
  // in" to avoid hitting "Log in with Facebook" instead.
  // Instagram answers the login by routing away from /accounts/login or by
  // showing its own alert; whichever comes first ends the wait.
  const ERR_SEL = '#slfErrorAlert, [data-bloks-name*="Error"], [role="alert"]';
  await humanClickLocator(
    s.page,
    s.page
      .locator('div[role="button"]')
      .filter({ hasText: /^\s*Log in\s*$/ })
      .filter({ visible: true })
      .first(),
  );
  await Promise.any([
    urlMatching(s.page, (u) => !/\/accounts\/login\/?$/.test(u)),
    s.page
      .locator(ERR_SEL)
      .filter({ hasText: /\S/ })
      .first()
      .waitFor({ state: 'visible' }),
  ]);
  await pageSettled(s.page);
  const finalUrl = s.page.url();
  console.log(`[instagram_login] post-submit url=${finalUrl}`);
  // The login form's own alert is Instagram's answer: any text it shows is
  // the refusal, quoted as it is, whatever its words.
  const err = await s.page.evaluate(
    (sel) =>
      Array.from(document.querySelectorAll(sel))
        .map((e) => e.textContent?.trim())
        .filter(Boolean),
    ERR_SEL,
  );
  if (err.length) throw new Error(`login form refused: ${err.join(' | ')}`);
  if (/\/accounts\/login/.test(finalUrl))
    throw new Error('login form did not submit / no redirect');
  const finalPath = new URL(finalUrl).pathname;
  if (CHECKPOINT_ROUTES.some((route) => finalPath.startsWith(route)))
    throw new Error(`checkpoint at ${finalUrl}`);
  if (SUSPENDED_ROUTES.some((route) => finalPath.startsWith(route)))
    throw new Error(`suspended: ${finalUrl}`);
  console.log(`PASS: logged in — ${finalUrl}`);
  await captureCookies();
} catch (e) {
  // Write a structured ban_signal so the worker doesn't fall back to
  // 'unknown_error'. instagram_login often fails on the post-submit verify-
  // email page; surface the final URL so the operator can see whether it
  // hit a captcha, verify wall, or just timed out.
  try {
    const dir = runRecordingsDir('instagram_login');
    mkdirSync(dir, { recursive: true });
    const finalUrl = s.page?.url?.() ?? '';
    // Suspended/disabled is the cleanest classification for an instagram
    // account that landed at /accounts/suspended/ or /accounts/disabled/ —
    // the login itself worked, the account is banned. Falling through to
    // 'action_failed' hides the actual state from rerun_failed.mjs which
    // would then pointlessly retry.
    // Order matters: HTTP-level rejection (4xx/5xx at edge) lands the page on
    // chrome-error://chromewebdata/ — same URL as a proxy CONNECT failure but
    // categorically different. ip_blocked → worker.markBurned rotates the
    // proxy host; action_failed leaves the burned IP in rotation. Match the
    // linkedin_login / twitter_login classifier ordering.
    const msg = e.message ?? '';
    // The signal is read from the address the page ended on and the
    // browser's error code; a page's prose is not classified by its words.
    let sig;
    const finalPath = URL.canParse(finalUrl)
      ? new URL(finalUrl).pathname
      : finalUrl;
    const refusal = navigationRefusal(msg, finalUrl);
    if (SUSPENDED_ROUTES.some((route) => finalPath.startsWith(route)))
      sig = 'suspended';
    else if (CHECKPOINT_ROUTES.some((route) => finalPath.startsWith(route)))
      sig = 'checkpoint';
    else if (refusal !== 'reached') sig = refusal;
    // Login form rendered but the trajectory threw before redirect (no form
    // inputs, submit blocked). Still on Instagram's login page means
    // cookies-stale: retrying the same path will hit the same wall.
    else if (finalPath.startsWith('/accounts/login') || finalPath === '/')
      sig = 'checkpoint';
    else sig = 'action_failed';
    writeFileSync(
      join(dir, 'ban_signal.json'),
      JSON.stringify(
        {
          account_id: acct.id,
          username: acct.username,
          action: 'instagram_login',
          signal: sig,
          healthy: false,
          details: { final_url: finalUrl, reason: e.message ?? 'no message' },
          ts: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    // If the platform suspended the account, flip is_active=false so
    // getSocialAccount stops picking it. Same pattern as discord_login.
    if (sig === 'suspended') {
      const { deactivateAccount } = await import(
        '../../../dist/account/state.js'
      );
      await deactivateAccount(acct.id, acct.metadata, 'INSTAGRAM_SUSPENDED');
    } else if (sig === 'checkpoint') {
      const { markCookiesStale } = await import(
        '../../../dist/utils/credentials.js'
      );
      if (acct.id) await markCookiesStale(acct.id);
    }
  } catch (persistErr) {
    // The signal, a suspended account's deactivation or a checkpoint's stale
    // cookies that did not land are said, not lost behind the FAIL line.
    console.log('[ban-signal] persist err:', persistErr.message);
  }
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
