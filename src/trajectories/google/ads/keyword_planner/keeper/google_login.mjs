// Signing the keeper's browser back in when Google interrupts a planner run.
// The loop reads the page's fields, answers the one Google put up — the
// identity, the password, the Authenticator code — and walks away as soon as
// the URL leaves accounts.google.com. Each field is recognised by what it is
// (its type and name), never by the words around it, and every form is sent
// with Enter, as a person submits it. A screen with no field to answer (a
// phone prompt waiting on a person, a method chooser) is waited on; the run's
// cancellation ends a sign-in that never completes.

import { generateTotp } from '../../../../_shared/services/google_sso.mjs';
import { preferredEmail } from './run_brief.mjs';
import { evalState, fillSelector, idle, press } from './keeper_browser.mjs';

const EMAIL_INPUT =
  'input[type="email"], input[name="identifier"], input#identifierId';
const PASSWORD_INPUT = 'input[type="password"], input[name="Passwd"]';
const TOTP_INPUT = 'input[name="totpPin"], input[name="Pin"]';

/** Whether a visible input on the page matches `pattern` on its type and name. */
function shows(state, pattern) {
  return state.inputs.some(
    (input) => input.visible && pattern.test(`${input.type} ${input.name}`),
  );
}

// Resolves true once the browser has left accounts.google.com.
export async function handleGoogleLogin(creds) {
  for (;;) {
    const s = await evalState();
    if (!/accounts\.google\.com/i.test(String(s.url))) return true;
    if (shows(s, /^email |identifier/i)) {
      await fillSelector(
        EMAIL_INPUT,
        creds.email || preferredEmail(),
        'Google email',
      );
      await press('Enter');
      continue;
    }
    if (shows(s, /^password |Passwd/i)) {
      await fillSelector(PASSWORD_INPUT, creds.password, 'Google password');
      await press('Enter');
      continue;
    }
    // The code is generated at each answer, so a refused one is answered with
    // the window that is current when the field asks again.
    if (creds?.totpSecret && shows(s, /totpPin| Pin$/)) {
      await fillSelector(
        TOTP_INPUT,
        generateTotp(creds.totpSecret),
        'Google TOTP',
      );
      await press('Enter');
      continue;
    }
    await idle('short');
  }
}
