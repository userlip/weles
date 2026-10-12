// Google's second factor, answered from this account's own stored secret.
//
// Google decides which method it offers, so the challenge is driven by what the
// page shows: the authenticator option when it is listed, the code field when it
// is on screen, and the other-ways control when Google parked the run on a
// method this driver cannot answer. Whether an option is offered, and where
// it is, the vision model answers (`../../page/judged/seen.mjs`) in whatever
// language Google speaks; the code field is found by its markup and a refused
// code by the field's own aria-invalid.
import { humanFill } from '../../../../../dist/human/keyboard.js';
import { pageSettled } from '../../page/settled.mjs';
import { clickDescribed, pageShows } from '../../page/judged/seen.mjs';
import { generateTotp, resolveTotpSecret } from './totp_secret.mjs';
import { logGooglePageDiag } from './page_diagnostics.mjs';

// 'present' | 'absent': whether Google lists the authenticator app as a way
// to verify.
async function googleAuthenticatorOptionState(page) {
  const offered = await pageShows(
    page,
    'Does the page offer getting a verification code from the Google Authenticator app as a way to verify?',
  );
  return offered ? 'present' : 'absent';
}

async function clickGoogleAuthenticatorOption(page) {
  console.log('[google_sso] selecting the Google Authenticator option');
  await clickDescribed(
    page,
    'the option to get a verification code from the Google Authenticator app',
  );
  return true;
}

// Which selector names Google's code field, most specific first. A page that
// cannot answer "is this field visible" is a broken page, and says so.
async function visibleTotpInput(page) {
  const codeFieldSelectors = [
    'input[name="totpPin"]',
    'input[name="Pin"]',
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[type="tel"]',
    'input[type="number"]',
    'input[type="text"]',
  ];
  for (const selector of codeFieldSelectors) {
    const input = page.locator(selector).filter({ visible: true }).first();
    if (await input.isVisible()) return input;
  }
  return null;
}

// Google's code form submits on Enter in its field.
async function submitGoogleSecondFactor(input) {
  await input.press('Enter');
  await pageSettled(input.page());
}

async function fillGoogleAuthenticatorTotp(page, creds) {
  const secret = resolveTotpSecret(creds);
  if (!secret) return false;
  await pageSettled(page);
  const input = await visibleTotpInput(page);
  if (!input) return false;
  const existing = await input.inputValue();
  let code = generateTotp(secret);
  if (!code) return false;
  // Google marks a refused code on the field itself. Only a field so marked,
  // or one already holding a whole code, forces a different one: the code of
  // the next window, which Google's one-step clock tolerance accepts, instead
  // of waiting for the window to turn.
  const codeRejected = (await input.getAttribute('aria-invalid')) === 'true';
  if (
    (codeRejected || (/^\d+$/.test(existing) && existing.length === 6)) &&
    code === existing
  ) {
    code = generateTotp(secret, { now: Date.now() + 30 * 1000 });
  }
  await humanFill(page, input, '');
  await humanFill(page, input, code);
  console.log(
    '[google_sso] filled Google Authenticator TOTP code from the exact scoped secret',
  );
  await submitGoogleSecondFactor(input);
  return true;
}

export async function handleGoogleAuthenticatorTotp(page, creds) {
  const secret = resolveTotpSecret(creds);
  if (!secret) return false;
  if (await visibleTotpInput(page)) {
    return await fillGoogleAuthenticatorTotp(page, creds);
  }
  if ((await googleAuthenticatorOptionState(page)) === 'present') {
    const clicked = await clickGoogleAuthenticatorOption(page);
    if (!clicked) {
      await logGooglePageDiag(page, 'authenticator_option_not_clickable');
      return false;
    }
  }
  const filled = await fillGoogleAuthenticatorTotp(page, creds);
  if (filled) return true;
  if (/signin\/challenge\/(dp|selection)/.test(page.url())) {
    if (await clickTryAnotherWay(page)) {
      if (await visibleTotpInput(page))
        return await fillGoogleAuthenticatorTotp(page, creds);
      if ((await googleAuthenticatorOptionState(page)) === 'present') {
        const clicked = await clickGoogleAuthenticatorOption(page);
        if (clicked && (await fillGoogleAuthenticatorTotp(page, creds)))
          return true;
      }
    }
  }
  if ((await googleAuthenticatorOptionState(page)) === 'present') {
    await logGooglePageDiag(page, 'authenticator_code_input_missing');
  }
  return false;
}

// Google's control for other ways to verify, when the page offers one; false
// when it does not.
export async function clickTryAnotherWay(page) {
  if (
    !(await pageShows(
      page,
      'Does the page offer a control that shows other ways to verify or sign in?',
    ))
  )
    return false;
  console.log('[google_sso] opening the other ways to verify');
  await clickDescribed(
    page,
    'the control that shows other ways to verify or sign in',
  );
  return true;
}
