// Signing in with the one-time code a provider mails to the account's
// address: the method of every account an acquisition buys, whose address is
// on an inbound domain Weles reads. The code is read by the shared mailed-code
// reader (../inputs/mailed_code.mjs), with the length the page's code field
// states, once the mail arrives.

import { humanFill } from '../../../../dist/human/keyboard.js';
import { pageSettled } from '../page/settled.mjs';
import { clickDescribed } from '../page/judged/seen.mjs';
import { fieldCodeLength, mailedCode } from '../inputs/mailed_code.mjs';
import { AuthenticationFailure } from './oauth.mjs';

/** Enter the address, wait for the mailed code, enter it. */
export async function emailCodeSignIn(session, login, sender, mark) {
  const page = session.page;
  const email = page
    .locator(
      'input[type="email"],input[autocomplete="email"],input[name="email"]',
    )
    .filter({ visible: true })
    .first();
  await email.waitFor({ state: 'visible' });
  await humanFill(page, email, login.email);
  await session.press('Enter');
  mark('email_code_requested');
  const box = page
    .locator(
      'input[autocomplete="one-time-code"],input[name="code"],input[inputmode="numeric"],input[id*="code" i]',
    )
    .filter({ visible: true })
    .first();
  await box.waitFor({ state: 'visible' });
  mark('email_code_waiting');
  let code;
  try {
    code = await mailedCode(login.email, sender, await fieldCodeLength(box));
  } catch (error) {
    throw new AuthenticationFailure(
      'email_code_unreadable',
      'email_code',
      `the sign-in mail to ${login.email} could not be read as a code: ${error.message}`,
    );
  }
  await humanFill(page, box, code);
  await session.press('Enter');
  await pageSettled(page);
  mark('email_code_entered');
}

/** Grant the authorization the provider's consent page asks for. */
export async function grantConsent(page, mark) {
  mark('oauth_consent');
  await clickDescribed(
    page,
    'the button that grants the authorization the page asks for',
  );
}
