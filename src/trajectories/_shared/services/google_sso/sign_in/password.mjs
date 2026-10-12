// Reaching Google's password field and submitting the password.
//
// Google does not always show that field: a "Welcome" page may list sign-in
// methods, and a passkey-only page may hide it behind "Try another way". So the
// step takes each of those ways at most once, reading the settled page before
// each choice, and refuses by name when none leads to a password field.
import { humanFill } from '../../../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../../../dist/human/mouse.js';
import { pageSettled } from '../../../page/settled.mjs';
import { clickDescribed } from '../../../page/judged/seen.mjs';
import { logGooglePageDiag } from '../page_diagnostics.mjs';
import { clickTryAnotherWay } from '../authenticator_challenge.mjs';
import { readAcrossNavigation } from '../../../page/navigation/read.mjs';

const PASSWORD_FIELD = 'input[type="password"], input[name="Passwd"]';

// true once the password has been typed and submitted; false when Google never
// offered the field, with the reason logged and its page state captured.
export async function submitGooglePassword(page, creds, passwordFieldCount) {
  let pwInVisible = passwordFieldCount || 0;
  let usedPasswordChoice = false;
  let usedTryAnotherWay = false;
  for (;;) {
    await pageSettled(page);
    pwInVisible = await page
      .locator(PASSWORD_FIELD)
      .filter({ visible: true })
      .count();
    if (pwInVisible > 0) break;

    // Google's "Welcome" / challenge selection page lists sign-in methods.
    // The password option is picked explicitly instead of looping on the
    // other-ways control; the vision model finds it in Google's language.
    const { pathname } = new URL(page.url());
    if (
      !usedPasswordChoice &&
      ['/challenge/selection', '/challenge/pk/presend'].some((route) =>
        pathname.includes(route),
      )
    ) {
      usedPasswordChoice = true;
      console.log('[google_sso] choosing the password sign-in method');
      await clickDescribed(
        page,
        'the option to sign in by entering the account password',
      );
      continue;
    }

    if (!usedTryAnotherWay) {
      usedTryAnotherWay = true;
      if (await clickTryAnotherWay(page)) continue;
    }

    console.log(`[google_sso] no progress option visible (url=${page.url()})`);
    break;
  }

  if (!pwInVisible) {
    await logGooglePageDiag(page, 'no_password_input');
    console.log(
      `[google_sso] FAIL: never reached password input (url=${page.url()})`,
    );
    return false;
  }

  const pwIn = page.locator(PASSWORD_FIELD).filter({ visible: true }).first();
  await humanFill(page, pwIn, creds.password);
  console.log('[google_sso] password filled');

  // Primary submit: press Enter while the password field still has focus.
  // Google's password form reliably submits on Enter in the input; previous
  // attempts to click the Next button hung because the button locator matched
  // a non-actionable / overlay element.
  console.log('[google_sso] pressing Enter to submit password');
  await pwIn.press('Enter');
  await pageSettled(page);

  // A password page still showing after Enter is sent with its own Next
  // control, which Google renders inside #passwordNext.
  if (/challenge\/pwd/.test(page.url()) && (await pwIn.isVisible())) {
    console.log(
      '[google_sso] password page still visible after Enter; clicking Next',
    );
    if (!(await pwIn.inputValue())) {
      console.log(
        '[google_sso] password input was cleared before the Next click; refilling',
      );
      await humanFill(page, pwIn, creds.password);
    }
    const passwordNext = page
      .locator('#passwordNext button')
      .filter({ visible: true })
      .first();
    if (await passwordNext.isVisible())
      await humanClickLocator(page, passwordNext);
    await pageSettled(page);
  }

  // Dispatch blur/focusout only after attempting submit. Google auto-submits
  // some flows, and then the document this evaluate was written against is
  // already gone — that navigation is the wanted outcome, not a failure. Any
  // other error is this page refusing the events and is raised.
  await readAcrossNavigation(page, () =>
    pwIn.evaluate((el) => {
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.dispatchEvent(new Event('focusout', { bubbles: true }));
    }),
  );

  return true;
}
