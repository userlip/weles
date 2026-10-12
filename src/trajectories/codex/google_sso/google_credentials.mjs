// Signing this account in at accounts.google.com: identifier, password, and the
// 2FA prompt Google puts between them and a session.
//
// Entry observes a writable field and verifies its value after trusted typing.
// Native input attributes do not prove WIZ hydration. The Next control must be
// enabled, and provider refusals are reported by the corresponding stage.
import { fillAndVerify, navEval } from './page_controls.mjs';
import { pageCondition, pageSettled } from '../../_shared/page/settled.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import {
  requireAuthenticatorCode,
  selectAuthenticatorMethod,
  waitForGoogleChallengeExit,
} from './authenticator_code.mjs';
import { resolveOtp } from '../../_shared/services/google_sso/sign_in/challenge/seed.mjs';
import { completeGooglePhoneApproval } from '../../_shared/services/google_sso/sign_in/challenge/phone.mjs';
import { readAcrossNavigation } from '../../_shared/page/navigation/read.mjs';

/** Google's own address for a sign-in it refuses as possibly not secure. */
const REJECTED = /\/signin\/rejected|deniedsigninrejected/;

export async function establishGoogleSession({
  page,
  login,
  mark,
  humanFill,
  humanClickLocator,
  humanType,
}) {
  mark('google_prelogin_goto');
  await page.goto('https://accounts.google.com/ServiceLogin?hl=en', {
    waitUntil: 'commit',
  });
  await enterGoogleCredentials({
    page,
    login,
    mark,
    humanFill,
    humanClickLocator,
    humanType,
  });
}

// Google refuses a sign-in it does not trust on its own rejection route.
function refuseIfRejected(page) {
  if (!REJECTED.test(new URL(page.url()).pathname)) return;
  const error = new Error(`Google refused sign-in at ${page.url()}`);
  error.code = 'BROWSER_NOT_SECURE';
  error.fatal2fa = true;
  throw error;
}

// The password can be an offered method, not a field yet: Google may list the
// ways to sign in, or show a passkey screen whose other ways include the
// password. Each is answered once, by the vision model, in that order.
export async function waitForGooglePassword({ page, mark }) {
  mark('google_password');
  const password = page
    .locator('input[type="password"]')
    .filter({ visible: true })
    .first();
  let selectedPassword = false;
  let openedAlternatives = false;
  for (;;) {
    await pageSettled(page);
    refuseIfRejected(page);
    if (await password.isVisible()) return password;
    if (
      !selectedPassword &&
      (await pageShows(
        page,
        'Does the page list ways to sign in that include entering the account password?',
      ))
    ) {
      selectedPassword = true;
      mark('google_password_choice');
      await clickDescribed(
        page,
        'the option to sign in by entering the account password',
      );
      mark('google_password');
      continue;
    }
    if (
      !selectedPassword &&
      !openedAlternatives &&
      (await pageShows(
        page,
        'Does the page offer a control that shows other ways to sign in?',
      ))
    ) {
      openedAlternatives = true;
      mark('google_password_alternatives');
      await clickDescribed(
        page,
        'the control that shows other ways to sign in',
      );
      mark('google_password');
      continue;
    }
    break;
  }
  const observed = await navEval(
    page,
    () => ({
      host: location.host,
      path: location.pathname,
      text: document.body.innerText.replace(/\s+/g, ' '),
    }),
    { state: 'page navigated before diagnosis' },
  );
  const error = new Error(
    `Google did not show the selected password challenge: ${JSON.stringify(observed)}`,
  );
  error.code = 'google_password_challenge_unavailable';
  error.fatal2fa = true;
  throw error;
}

// Remaining on the password screen is pending, not proof of a wrong password.
// Google marks a refused password on the field itself (aria-invalid), refuses
// an untrusted sign-in on its rejection route, and states any other refusal in
// the page's assertive live region; each is different from leaving the page.
export async function waitForGooglePasswordResult(page) {
  const observed = await pageCondition(
    page,
    (rejected) => {
      if (!/^https?:$/.test(location.protocol)) return false;
      const state = { host: location.host, path: location.pathname };
      if (location.hostname !== 'accounts.google.com') return state;
      const text = document.body.innerText.replace(/\s+/g, ' ');
      if (new RegExp(rejected).test(location.pathname))
        return { ...state, text, code: 'BROWSER_NOT_SECURE' };
      const alert = Array.from(
        document.querySelectorAll('[aria-live="assertive"], [role="alert"]'),
      )
        .map((region) => region.innerText.trim())
        .find(Boolean);
      if (alert)
        return { ...state, text: alert, code: 'provider_challenge_refused' };
      const password = Array.from(
        document.querySelectorAll('input[type="password"]'),
      ).find((input) => input.checkVisibility({ visibilityProperty: true }));
      if (password?.getAttribute('aria-invalid') === 'true') {
        return {
          ...state,
          code: 'GOOGLE_PASSWORD_REJECTED',
          text,
          invalidInput: {
            name: password.name,
            ariaInvalid: password.getAttribute('aria-invalid'),
          },
        };
      }
      if (password || /\/challenge\/pwd(?:\/|$)/.test(location.pathname))
        return false;
      return state;
    },
    REJECTED.source,
  );
  if (observed.code) {
    const error = new Error(
      `Google password step reports a refusal: ${JSON.stringify(observed)}`,
    );
    error.code = observed.code;
    throw error;
  }
}

// Email -> password -> 2FA entry on accounts.google.com. Extracted verbatim
// from establishGoogleSession so it can be reused when a first-time account is
// entered via "Use another account" on the authorize chooser.
export async function enterGoogleCredentials({
  page,
  login,
  mark,
  humanFill,
  humanClickLocator,
  humanType,
}) {
  mark('google_email');
  // Visible markup alone does not guarantee that dispatched input is retained.
  // Observe the writable state, then verify readback without blind retyping.
  // Google sign-in v2 renders the identifier field as input[type="text"]
  // with autocomplete="username webauthn" (id="identifierId") rather than
  // type="email". Match either variant so the locator survives A/B changes.
  const gEmailIn = page
    .locator(
      'input[type="text"][autocomplete*="username"], input#identifierId, input[name="identifier"], input[type="email"]',
    )
    .filter({ visible: true })
    .first();
  await gEmailIn.waitFor({ state: 'visible' });
  // Each step that waits on the page is its own stage, so a stall names it.
  mark('google_email_field_visible');
  await fillAndVerify(
    page,
    gEmailIn,
    login.email,
    humanClickLocator,
    humanType,
  );
  mark('google_email_typed');
  // Trusted typing delivers key/input events. Dispatch focusout/blur for the
  // field's on-blur validator before observing the Next control's enabled state.
  // Only an observed replacement may interrupt these optional blur events.
  await readAcrossNavigation(page, () =>
    gEmailIn.evaluate((el) => {
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.dispatchEvent(new Event('focusout', { bubbles: true }));
    }),
  );
  // Google's sign-in forms submit on Enter in their field, as a person sends
  // them; no Next button is looked up by its label.
  await gEmailIn.press('Enter');
  mark('google_email_submitted');

  const gPwIn = await waitForGooglePassword({ page, mark, humanClickLocator });
  await fillAndVerify(
    page,
    gPwIn,
    login.password,
    humanClickLocator,
    humanType,
  );
  await readAcrossNavigation(page, () =>
    gPwIn.evaluate((el) => {
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.dispatchEvent(new Event('focusout', { bubbles: true }));
    }),
  );
  await gPwIn.press('Enter');
  await waitForGooglePasswordResult(page);

  mark('google_2fa_check');
  const otpSel =
    'input[type="tel"][autocomplete="one-time-code"], input[name="totpPin"], input[autocomplete="one-time-code"]';
  const gOtp = () => page.locator(otpSel).filter({ visible: true }).first();
  if (
    !resolveOtp(login) &&
    (await completeGooglePhoneApproval(
      page,
      login.email,
      `google-sign-in ${login.email}`,
    ))
  ) {
    mark('google_2fa_phone', { required: true, method: 'phone' });
    return;
  }
  // A code field may require selecting its method first; absence is not a
  // failed observation and must not hold the method chooser unreachable.
  if (!(await gOtp().isVisible())) {
    // DIAGNOSTIC: dump what is actually on screen so the selector can be fixed
    // without guessing. Logs the URL path + visible clickable labels (Google UI
    // chrome text — account emails/codes are not button labels, so no secrets).
    try {
      const diag = await page.evaluate(() => {
        const texts = [];
        for (const el of Array.from(
          document.querySelectorAll('button,[role="button"],a,li,span,div'),
        )) {
          const t = (el.innerText || el.textContent || '').trim();
          if (!t || t.length > 45) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          if (!texts.includes(t)) texts.push(t);
          if (texts.length >= 25) break;
        }
        return { path: location.pathname, host: location.host, texts };
      });
      console.log(
        `[google_sso] 2fa-diag host=${diag.host} path=${diag.path} clickables=${JSON.stringify(diag.texts)}`,
      );
    } catch (e) {
      console.log(`[google_sso] 2fa-diag failed: ${e.message}`);
    }
    // No code field yet. Either Google defaulted to push/SMS (switch to the
    // authenticator method to force a TOTP field) or this account has no 2FA
    // (no method-chooser present) — then there is nothing to answer.
    const result = await selectAuthenticatorMethod(
      page,
      Boolean(login.totpSecret),
    );
    if (result === 'no-2fa') {
      mark('google_2fa_not_requested', { required: false, method: null });
      console.log('[google_sso] no 2fa challenge present — nothing to answer');
      return;
    }
    if (result === 'stuck') {
      const err = new Error(
        'google 2FA present but could not switch to authenticator — aborting to avoid push/sms loop',
      );
      err.fatal2fa = true;
      err.code = 'google_authenticator_method_unavailable';
      err.second_factor = { required: true, method: null };
      throw err;
    }
    console.log(
      '[google_sso] selected authenticator (TOTP) method via "Try another way"',
    );
    await gOtp().waitFor({ state: 'visible' });
  }
  // A code field is showing — it MUST be answered now. Aborting here (rather
  // than going on) prevents the authorize->chooser->re-enter loop from
  // re-submitting the password and re-triggering another push/SMS to the user.
  mark('google_2fa_authenticator', { required: true, method: 'authenticator' });
  const otp = await requireAuthenticatorCode(page, resolveOtp(login));
  await humanFill(page, gOtp(), otp);
  await gOtp().press('Enter');
  await waitForGoogleChallengeExit(page);
}
