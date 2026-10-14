// The switch to the authenticator method on Google's 2FA prompt and the wait
// for that prompt to end. The code itself comes only from the account's seed
// (sign_in/challenge/seed.mjs); the credential driver handles an offered phone
// approval when no seed is held.
import { navEval } from '../../_shared/page/navigation/read.mjs';
import { pageCondition } from '../../_shared/page/settled.mjs';
import { clickOffered } from '../../_shared/page/judged/seen.mjs';
import { clickTryAnotherWay } from '../../_shared/services/google_sso/authenticator_challenge.mjs';
import { logGooglePageDiag } from '../../_shared/services/google_sso/page_diagnostics.mjs';

async function googleChallengeState(page, terminalOnly = false) {
  const read = (waitForTerminal) => {
    const observed = {
      host: location.host,
      path: location.pathname,
      // Google's second-factor screens live on its challenge routes.
      challenge:
        location.hostname === 'accounts.google.com' &&
        /\/challenge(?:\/|$)/.test(location.pathname),
    };
    if (waitForTerminal && observed.challenge) {
      let invalidInput = null;
      for (const input of document.querySelectorAll(
        'input[name="totpPin"][aria-invalid="true"], input[autocomplete="one-time-code"][aria-invalid="true"]',
      )) {
        const rect = input.getBoundingClientRect();
        if (
          rect.width > 0 &&
          rect.height > 0 &&
          getComputedStyle(input).visibility === 'visible'
        ) {
          invalidInput = {
            name: input.name,
            autocomplete: input.getAttribute('autocomplete'),
            ariaInvalid: input.getAttribute('aria-invalid'),
          };
          break;
        }
      }
      if (!invalidInput) return false;
      observed.invalidInput = invalidInput;
    }
    observed.text = (
      document.querySelector('main')?.innerText ||
      document.body?.innerText ||
      ''
    ).replace(/\s+/g, ' ');
    return observed;
  };
  if (terminalOnly) return pageCondition(page, read, true);
  return navEval(
    page,
    read,
    { challenge: null, state: 'navigation in progress' },
    false,
  );
}

function challengeFailure(code, message, observed) {
  const error = new Error(`${message}: ${JSON.stringify(observed)}`);
  error.code = code;
  error.fatal2fa = true;
  if (observed?.challenge === true)
    error.second_factor = { required: true, method: null };
  return error;
}

// A missing seed has one structured outcome whether the code field is already
// visible or Google first presents a method chooser. Brama consumes the code,
// not a substring of the diagnostic, to start the account's recovery flow.
export async function requireAuthenticatorCode(page, code) {
  if (typeof code === 'string' && code.trim()) return code.trim();
  throw challengeFailure(
    'google_2fa_material_missing',
    'The selected login has no authenticator seed. ' +
      'Brama sign-in can request Weles authenticator enrolment and resume this account ' +
      'after the seed is confirmed; any required phone approval appears in Weles operator requests.',
    await googleChallengeState(page),
  );
}

// A challenge that is still displayed is pending, not evidence of refusal.
// Observe its exit or the code input's explicit invalid state; browser errors
// remain observation errors rather than being relabeled as a rejected code.
export async function waitForGoogleChallengeExit(page) {
  const observed = await googleChallengeState(page, true);
  if (observed.challenge === false) return;
  throw challengeFailure(
    'provider_challenge_refused',
    'Google marks the verification input invalid',
    observed,
  );
}

// Select only an authenticator method the supplied login can answer: the
// Google Authenticator option, found by the vision model; when the challenge
// shows another method, Google's own other-ways control (clickTryAnotherWay)
// opens the chooser that lists it.
export async function selectAuthenticatorMethod(page, hasCode) {
  const observed = await googleChallengeState(page);
  if (observed.challenge === false) return 'no-2fa';
  if (observed.challenge === null) {
    throw challengeFailure(
      'google_sign_in_state_unavailable',
      'Google sign-in state could not be read',
      observed,
    );
  }
  if (!hasCode) await requireAuthenticatorCode(page, null);
  const chooseAuthenticator = () =>
    clickOffered(
      page,
      'the option to get a verification code from the Google Authenticator app',
    );
  // Google can open the method chooser directly, without another menu step.
  if (await chooseAuthenticator()) return 'switched';
  if (!(await clickTryAnotherWay(page))) return 'stuck';
  await logGooglePageDiag(page, '2fa_methods');
  return (await chooseAuthenticator()) ? 'switched' : 'stuck';
}
