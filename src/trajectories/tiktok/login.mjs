import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { humanType } from '../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { persistFreshCookieJar } from '../_shared/auth/cookie-freshness.mjs';
import { screenshotIfPossible } from '../_shared/runner/evidence.mjs';
import { solveTiktokRotateCaptcha } from './login/rotate_captcha.mjs';
import { seedRegionCookies, mockRegionEndpoint } from './login/region.mjs';
import {
  completeNewDeviceVerification,
  verifyDialogPresent,
} from './login/new_device_verify.mjs';
import { waitForSignedIn } from './login/session_wait.mjs';
import { recordLoginFailure, refusedLogin } from './login/failure_signal.mjs';

const PASSWORD_URL =
  'https://www.tiktok.com/login/phone-or-email/email?lang=en';
const CAPTCHA_MODAL =
  '.captcha-verify-container, .captcha_verify_container, [class*="captcha-"]';
const SUBMIT = 'button[data-e2e="login-button"], button[type="submit"]';

// There is deliberately no cookie-first login here — see auth-probe.mjs for
// the full rationale. Short version: cookies present + URL didn't bounce ≠
// session is authed. TikTok serves /foryou and /messages with logged-out
// shells when the session is device-mismatched, so cookie-first declared PASS
// while the comment input never rendered for the supposedly-logged-in user.
// Login always means form login. Action trajectories use assertAuthed() from
// auth-probe.mjs to verify a session is real.

const acct = await getSocialAccount('tiktok');
if (!acct) {
  console.log('FAIL: no active tiktok account in DB');
  process.exitCode = 1;
}
process.env.SVC_EMAIL = acct.metadata.email ?? acct.username;
process.env.SVC_PASSWORD = acct.metadata.password ?? '';
console.log(`[trajectory] Using account: ${acct.username}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'tiktok_login',
  proxy: proxyUrl,
  persona,
});
const loginDiag = {
  account_id: acct.id,
  username: acct.username,
  // TikTok's own refusal of the sign-in: the first passport login answer
  // whose message is not success, with its data (error_code, description).
  refusal: null,
  loginResponses: [],
  failedRequests: [],
  captcha: { present: false, solved: false },
  finalState: null,
};

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

/** TikTok's own passport sign-in calls. */
const PASSPORT_LOGIN =
  /\/passport\/web\/(login|login_with_email|account_check)\/?$/;

/**
 * Record the passport login answers with their bodies, every failed request
 * and every console message into loginDiag and the log. A refusal is
 * TikTok's own answer to its login call, read from that answer, not from
 * words in the console.
 */
function observeLoginTraffic(page) {
  page.on('response', async (res) => {
    const u = res.url();
    if (!PASSPORT_LOGIN.test(new URL(u).pathname)) return;
    const entry = { url: u, status: res.status(), ts: Date.now() };
    loginDiag.loginResponses.push(entry);
    try {
      entry.body = await res.text();
    } catch (error) {
      entry.body_error = error.message;
      return;
    }
    let answer;
    try {
      answer = JSON.parse(entry.body);
    } catch (error) {
      entry.body_error = `not JSON: ${error.message}`;
      return;
    }
    if (answer?.message !== 'success' && loginDiag.refusal === null)
      loginDiag.refusal = { url: u, status: entry.status, answer };
  });
  page.on('requestfailed', (req) => {
    const headers = req.headers();
    loginDiag.failedRequests.push({
      url: req.url(),
      failure: req.failure()?.errorText,
      method: req.method(),
      origin: headers.origin ? headers.origin : headers.referer,
    });
  });
  page.on('console', (msg) =>
    console.log(`[tiktok_login] page-${msg.type()}: ${msg.text()}`),
  );
}

/** Fill the email/password form. Its selectors are stable on TikTok's login page. */
async function fillLoginForm(page) {
  await s.goto(PASSWORD_URL);
  const emailIn = page
    .locator(
      'input[name="username"], input[type="text"][placeholder*="email" i], input[type="email"]',
    )
    .filter({ visible: true })
    .first();
  const pwIn = page
    .locator('input[type="password"]')
    .filter({ visible: true })
    .first();
  await emailIn.waitFor({ state: 'visible' });
  await humanClickLocator(page, emailIn);
  await humanIdlePause('short');
  await humanType(page, process.env.SVC_EMAIL);
  await humanIdlePause('short');
  await humanClickLocator(page, pwIn);
  await humanIdlePause('short');
  await humanType(page, process.env.SVC_PASSWORD);
  await humanIdlePause('short');
  // Diagnostic: snapshot field values + button enabled state right before
  // the click. If button is still disabled, typing didn't fully register.
  const formState = await page
    .evaluate(() => {
      const u = document.querySelector('input[name="username"]');
      const p = document.querySelector('input[type="password"]');
      const b = document.querySelector('button[data-e2e="login-button"]');
      return {
        usernameLen: u?.value?.length ?? -1,
        passwordLen: p?.value?.length ?? -1,
        buttonDisabled: b?.disabled,
        buttonAria: b?.getAttribute('aria-disabled'),
      };
    })
    .catch((e) => ({ err: e.message }));
  console.log(
    `[tiktok_login] form-state pre-submit: ${JSON.stringify(formState)}`,
  );
  await screenshotIfPossible(s, 'pre_submit');
}

/** Solve the rotate captcha, refreshing the puzzle between attempts, then re-submit. */
async function passCaptcha(page) {
  console.log(
    '[tiktok_login] captcha modal detected — attempting SadCaptcha solve',
  );
  // Every solve is a paid SadCaptcha call; how many one login may spend is
  // the operator's TIKTOK_CAPTCHA_SOLVE_BUDGET, required.
  const budget = Number(process.env.TIKTOK_CAPTCHA_SOLVE_BUDGET);
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new Error(
      'captcha_challenge: TIKTOK_CAPTCHA_SOLVE_BUDGET must say how many paid captcha solves one login may spend (a positive whole number)',
    );
  }
  let solved = false;
  // retry-allowed: each attempt is a different rotate puzzle after the widget's
  // own refresh control, which is how a person clears one they cannot solve.
  for (let attempt = 0; attempt < budget && !solved; attempt++) {
    if (attempt > 0) {
      // Click captcha refresh button to get a new puzzle. The icon is a
      // circular arrow at the bottom-right of the modal footer.
      const refresh = page
        .locator(CAPTCHA_MODAL)
        .locator(
          'button, [role="button"], [class*="refresh" i], [class*="reload" i]',
        )
        .filter({ visible: true })
        .first();
      const refreshed = (await refresh.count()) > 0;
      if (refreshed) await humanClickLocator(page, refresh);
      console.log(
        `[tiktok_login] captcha retry ${attempt} refresh-clicked=${refreshed}`,
      );
      await humanIdlePause('short');
    }
    solved = await solveTiktokRotateCaptcha(page);
    console.log(
      `[tiktok_login] captcha attempt ${attempt + 1} solved=${solved}`,
    );
  }
  loginDiag.captcha.solved = solved;
  if (!solved) {
    await screenshotIfPossible(s, 'captcha_solve_failed');
    throw new Error(
      `captcha_challenge: SadCaptcha solve failed after ${budget} attempts (TIKTOK_CAPTCHA_SOLVE_BUDGET)`,
    );
  }
  // After captcha dismiss, TikTok web does NOT auto-submit the login form
  // Re-click submit manually to fire /passport/web/login/.
  await humanIdlePause('short');
  const reSubmit = page.locator(SUBMIT).filter({ visible: true }).first();
  if (await reSubmit.count().catch(() => false)) {
    try {
      await humanClickLocator(page, reSubmit);
      console.log('[tiktok_login] post-captcha re-submit clicked');
    } catch (e) {
      console.log(`[tiktok_login] re-submit click err: ${e.message}`);
    }
  }
  await humanIdlePause('deliberate');
  console.log(
    `[tiktok_login] post-captcha loginResponses=${JSON.stringify(loginDiag.loginResponses)}`,
  );
  if (loginDiag.refusal) throw refusedLogin(loginDiag);
}

try {
  await seedRegionCookies(s.ctx);
  await fillLoginForm(s.page);
  observeLoginTraffic(s.page);
  await mockRegionEndpoint(s.page);
  const submitBtn = s.page.locator(SUBMIT).filter({ visible: true }).first();
  await humanClickLocator(s.page, submitBtn);
  console.log(
    `[tiktok_login] submit clicked, waiting for sessionid (${loginDiag.loginResponses.length} login XHR captured so far)`,
  );
  await humanIdlePause('deliberate');
  await screenshotIfPossible(s, 'post_submit_3s');
  console.log(
    `[tiktok_login] +3s loginResponses=${JSON.stringify(loginDiag.loginResponses)}`,
  );
  console.log(
    `[tiktok_login] +3s failedRequests=${JSON.stringify(loginDiag.failedRequests)}`,
  );
  // Captcha modal check. Excludes the "Verify it's really you" dialog which
  // shares the captcha-* class prefix but is an OTP flow handled below.
  const verifyDialogText = await verifyDialogPresent(s.page);
  const captchaPresent =
    !verifyDialogText &&
    (await s.page
      .evaluate((modal) => !!document.querySelector(modal), CAPTCHA_MODAL)
      .catch(() => false));
  loginDiag.captcha.present = captchaPresent;
  if (captchaPresent) await passCaptcha(s.page);
  // After the captcha, TikTok may ask a new device to prove the email. When
  // the dialog is absent this is a no-op.
  if (await verifyDialogPresent(s.page))
    await completeNewDeviceVerification(s, acct);
  await waitForSignedIn(s, loginDiag);
  console.log('PASS: logged in (deterministic email/password)');
  await captureCookies();
} catch (e) {
  try {
    await recordLoginFailure(e, s, acct, loginDiag);
  } catch (recordError) {
    console.log(
      `[tiktok_login] could not record the failure: ${recordError.message}`,
    );
  }
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
