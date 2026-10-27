// Signing a keeper's browser in to Google, for the runners that drive a
// browser they do not own. Where the page is on Google's sign-in host says
// which step Google shows, whatever language its words are in; each step is
// answered once per address, as a person would, and a step still showing at
// the same address after its answer settled (a refused password or code, an
// email Google does not know) is refused with the steps seen. A step this
// driver does not answer (a device prompt waiting on a phone, a security
// challenge) is refused by name.
//
// `act(command)` sends one keeper command and resolves its answer, throwing
// when the keeper refuses; `login` is `{ email, password, totpSecret? }`.

import { generateTotp } from '../services/google_sso.mjs';
import { onGoogleSignIn } from '../profile/google_session.mjs';

/** Google's sign-in steps, by the path Google serves each on. */
const GOOGLE_STEPS = [
  { step: 'email', path: /\/signin\/identifier$/ },
  { step: 'password', path: /\/challenge\/pwd$/ },
  { step: 'authenticator', path: /\/challenge\/totp$/ },
  { step: 'choose_method', path: /\/challenge\/selection$/ },
  { step: 'device_prompt', path: /\/challenge\/dp$/ },
  { step: 'blocked', path: /\/challenge\/recaptcha$/ },
  { step: 'blocked', path: /^\/sorry\// },
  { step: 'consent', path: /\/signin\/oauth\// },
  { step: 'consent', path: /\/oauthconsent$/ },
];

const EMAIL_INPUT =
  'input[type="email"], input[name="identifier"], input#identifierId';
const PASSWORD_INPUT = 'input[type="password"], input[name="Passwd"]';
const TOTP_INPUT = 'input[name="totpPin"], input[name="Pin"]';

/** The step Google shows at `address`, or 'left_google' off its sign-in host. */
export function googleStep(address) {
  if (!onGoogleSignIn(address)) return 'left_google';
  const { pathname } = new URL(address);
  const known = GOOGLE_STEPS.find(({ path }) => path.test(pathname));
  return known ? known.step : 'unknown';
}

function filled(selector, text) {
  return [
    { action: 'fill', selector, text },
    { action: 'press', key: 'Enter' },
  ];
}

/** The keeper commands that answer `step` for `login`, or null for none. */
function answerFor(step, login) {
  if (step === 'email') return filled(EMAIL_INPUT, login.email);
  if (step === 'password') return filled(PASSWORD_INPUT, login.password);
  // The code is generated when the step is answered, from the login's secret.
  if (step === 'authenticator' && login.totpSecret)
    return filled(TOTP_INPUT, generateTotp(login.totpSecret));
  if (step === 'choose_method')
    return [
      {
        action: 'click_described',
        description: login.totpSecret
          ? 'the option to get a verification code from the Google Authenticator app'
          : 'the option to sign in by entering the password',
      },
    ];
  // A consent screen that cannot be answered leaves the account signed out
  // of the target; the keeper's own refusal fails the run.
  if (step === 'consent')
    return [
      {
        action: 'click_described',
        description:
          'the button that grants the application the access it asks for and continues to it',
      },
    ];
  return null;
}

async function currentUrl(act) {
  const { url } = await act({ action: 'url' });
  if (typeof url !== 'string')
    throw new Error(
      'KEEPER_ANSWER_INCOMPLETE: the keeper answered no page address',
    );
  return url;
}

/**
 * Answer Google's sign-in steps until the browser leaves Google's sign-in
 * host. Resolves the steps answered, each with the address it was shown at.
 */
export async function signInThroughKeeper(act, login) {
  const steps = [];
  const answeredAt = new Set();
  for (;;) {
    const address = await currentUrl(act);
    const step = googleStep(address);
    if (step === 'left_google') return steps;
    const answer = answerFor(step, login);
    if (!answer)
      throw Object.assign(
        new Error(
          `GOOGLE_SIGN_IN_${step.toUpperCase()}: Google stopped the sign-in at ${address}; steps: ${JSON.stringify(steps)}`,
        ),
        { steps },
      );
    if (answeredAt.has(`${step} ${address}`))
      throw Object.assign(
        new Error(
          `GOOGLE_SIGN_IN_STEP_REPEATED: Google still shows the ${step} step at ${address} after it was answered; steps: ${JSON.stringify(steps)}`,
        ),
        { steps },
      );
    answeredAt.add(`${step} ${address}`);
    for (const command of answer) await act(command);
    await act({ action: 'settle' });
    steps.push({ step, url: address });
  }
}
