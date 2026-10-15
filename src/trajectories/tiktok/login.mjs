// Sign the active TikTok account in through its email login form, through
// the shared login runner (../_shared/action/login.mjs): the account, its
// proxy, the kept session and the verdict are the runner's.
//
// Login is always the form: a stored jar on a device TikTok does not trust
// shows a signed-out shell. TikTok's own passport answers decide a refusal.
// A rotate captcha is solved through SadCaptcha, as many times as
// TIKTOK_CAPTCHA_SOLVE_BUDGET (required) allows, the puzzle refreshed by its
// own control between attempts; a new device is verified by the code TikTok
// mails (./login/new_device_verify.mjs). The login counts once TikTok sets
// its sessionid cookie and leaves /login (./login/session_wait.mjs). What
// the login saw is kept in the run's login_diag.json.
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { detectTikTokBanSignals } from '../../../dist/platforms/tiktok/ban_signals.js';
import { runLogin } from '../_shared/action/login.mjs';
import { statedCount } from '../_shared/inputs/stated.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { screenshotIfPossible } from '../_shared/runner/evidence.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { solveTiktokRotateCaptcha } from './login/rotate_captcha.mjs';
import { seedRegionCookies, mockRegionEndpoint } from './login/region.mjs';
import { completeNewDeviceVerification, verifyDialogPresent } from './login/new_device_verify.mjs';
import { waitForSignedIn } from './login/session_wait.mjs';
import { explainLoginFailure, refusedLogin, unpassedCaptcha } from './login/failure_signal.mjs';

const PASSWORD_URL = 'https://www.tiktok.com/login/phone-or-email/email?lang=en';
const CAPTCHA_MODAL = '.captcha-verify-container, .captcha_verify_container, [class*="captcha-"]';
const SUBMIT = 'button[data-e2e="login-button"], button[type="submit"]';
/** TikTok's own passport sign-in calls. */
const PASSPORT_LOGIN = /\/passport\/web\/(login|login_with_email|account_check)\/?$/;

/**
 * Record the passport login answers with their bodies, and every failed
 * request, into `diag`. A refusal is TikTok's own answer to its login call:
 * the first whose message is not success.
 */
function observeLoginTraffic(page, diag) {
  page.on('response', async (res) => {
    if (!PASSPORT_LOGIN.test(new URL(res.url()).pathname)) return;
    const entry = { url: res.url(), status: res.status(), ts: Date.now() };
    diag.loginResponses.push(entry);
    let unread;
    try {
      entry.body = await res.text();
    } catch (error) {
      unread = error;
    }
    if (unread) {
      entry.body_error = unread.message;
      return;
    }
    let answer;
    try {
      answer = JSON.parse(entry.body);
    } catch (error) {
      unread = error;
    }
    if (unread) {
      entry.body_error = `not JSON: ${unread.message}`;
      return;
    }
    if (answer.message !== 'success' && !diag.refusal)
      diag.refusal = { url: res.url(), status: entry.status, answer };
  });
  page.on('requestfailed', (req) =>
    diag.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText, method: req.method() }),
  );
}

/** Solve the rotate captcha within the stated budget, then submit again. */
async function passCaptcha(s, diag) {
  // Every solve is a paid SadCaptcha call.
  const budget = statedCount(
    'TIKTOK_CAPTCHA_SOLVE_BUDGET',
    'how many paid captcha solves one login may spend',
    'TIKTOK_CAPTCHA_SOLVE_BUDGET_REQUIRED',
  );
  for (const attempt of Array(budget).keys()) {
    if (attempt) {
      // A new puzzle, through the widget's own refresh control: how a person
      // clears a puzzle they cannot solve.
      await clickDescribed(s.page, 'the control in the captcha that loads a new puzzle');
      await pageSettled(s.page);
    }
    diag.captcha.solved = await solveTiktokRotateCaptcha(s.page);
    console.log(`[tiktok_login] captcha attempt after ${attempt} earlier: solved=${diag.captcha.solved}`);
    if (diag.captcha.solved) break;
  }
  if (!diag.captcha.solved) {
    await screenshotIfPossible(s, 'captcha_solve_failed');
    throw unpassedCaptcha(`SadCaptcha did not solve the puzzle within ${budget} attempts (TIKTOK_CAPTCHA_SOLVE_BUDGET)`);
  }
  // TikTok does not submit the form again once its captcha closes.
  await humanClickLocator(s.page, s.page.locator(SUBMIT).filter({ visible: true }).first());
  await pageSettled(s.page);
  if (diag.refusal) throw refusedLogin(diag);
}

await runLogin({
  platform: 'tiktok',
  banDetector: detectTikTokBanSignals,
  signIn: async (s, { acct, login, password }) => {
    const diag = {
      account_id: acct.id,
      username: acct.username,
      refusal: null,
      loginResponses: [],
      failedRequests: [],
      captcha: { present: false, solved: false },
      finalState: null,
    };
    let failure;
    try {
      await seedRegionCookies(s.ctx);
      await s.goto(PASSWORD_URL);
      await pageSettled(s.page);
      const address = s.page.locator('input[name="username"], input[type="email"]').filter({ visible: true }).first();
      const secret = s.page.locator('input[type="password"]').filter({ visible: true }).first();
      if (!(await address.count()) || !(await secret.count()))
        throw new Error(`TIKTOK_LOGIN_FORM_MISSING: ${s.page.url()} shows no email login form`);
      await humanClickLocator(s.page, address);
      await humanType(s.page, login);
      await humanClickLocator(s.page, secret);
      await humanType(s.page, password);
      observeLoginTraffic(s.page, diag);
      await mockRegionEndpoint(s.page);
      await humanClickLocator(s.page, s.page.locator(SUBMIT).filter({ visible: true }).first());
      await pageSettled(s.page);
      // The "verify it's really you" dialog shares the captcha class prefix
      // but is the new-device flow, handled after the captcha.
      diag.captcha.present =
        !(await verifyDialogPresent(s.page)) && Boolean(await s.page.locator(CAPTCHA_MODAL).count());
      if (diag.captcha.present) await passCaptcha(s, diag);
      if (await verifyDialogPresent(s.page)) await completeNewDeviceVerification(s, acct);
      await waitForSignedIn(s, diag);
    } catch (error) {
      failure = await explainLoginFailure(error, s, diag);
    }
    if (failure) throw failure;
  },
});
