// Drive an already-open keeper through Google SSO using a Weles service credential.
// This is for interactive keeper verification, not a one-shot trajectory.
//
// Each step Google shows is answered once per address: a step still showing
// at the same address after its answer settled (a refused password, an
// email Google does not know) is refused with the steps seen so far, never
// answered again.

import { parseArgs } from 'node:util';
import { keeperRequest, keeperSocket } from '../_shared/keeper/client.mjs';
import { getCredential } from '../../lib/service_credentials.mjs';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { onGoogleSignIn } from '../_shared/profile/google_session.mjs';

const INDENT = '  ';

function runArgs() {
  const { values } = parseArgs({
    options: {
      session: { type: 'string' },
      'credential-id': { type: 'string' },
      'target-url': { type: 'string' },
    },
  });
  const session = values.session || process.env.SESSION;
  if (!session) throw new Error('missing --session or SESSION');
  if (!values['credential-id']) throw new Error('missing --credential-id');
  return {
    session,
    credentialId: values['credential-id'],
    targetUrl: values['target-url'],
  };
}

async function action(session, cmd) {
  const answer = await keeperRequest(keeperSocket(session), cmd);
  if (!answer.ok)
    throw new Error(
      `keeper action ${cmd.action} failed: ${answer.error ? answer.error : 'the keeper gave no reason'}`,
    );
  return answer;
}

/** A string field of a keeper answer, refused when the keeper sent none. */
function answered(res, field, what) {
  if (typeof res[field] !== 'string')
    throw new Error(
      `KEEPER_ANSWER_INCOMPLETE: the keeper's answer for ${what} carries no ${field}: ${JSON.stringify(res)}`,
    );
  return res[field];
}

async function text(session) {
  const res = await action(session, {
    action: 'eval',
    js: 'document.body.innerText',
  });
  return answered(res, 'result', 'the page text');
}

async function url(session) {
  return answered(await action(session, { action: 'url' }), 'url', 'the page address');
}

/**
 * Google's sign-in steps, by the path Google serves each on: where the page
 * is says which step it is, whatever language its words are in.
 */
const GOOGLE_STEPS = [
  { step: 'email', path: /\/signin\/identifier$/ },
  { step: 'password', path: /\/challenge\/pwd$/ },
  { step: 'choose_method', path: /\/challenge\/selection$/ },
  { step: 'blocked', path: /\/challenge\/recaptcha$/ },
  { step: 'blocked', path: /^\/sorry\// },
  { step: 'consent', path: /\/signin\/oauth\// },
  { step: 'consent', path: /\/oauthconsent$/ },
];

function googleStep(address) {
  if (!onGoogleSignIn(address)) return 'left_google';
  const { pathname } = new URL(address);
  const known = GOOGLE_STEPS.find(({ path }) => path.test(pathname));
  return known ? known.step : 'unknown';
}

/** The keeper action that answers `step`, or null when this driver answers none. */
function answerFor(step, credential) {
  if (step === 'email')
    return [
      {
        action: 'fill',
        selector: 'input[type="email"]',
        text: credential.login_email,
      },
      { action: 'press', key: 'Enter' },
    ];
  if (step === 'password')
    return [
      {
        action: 'fill',
        selector: 'input[type="password"]',
        text: credential.login_password,
      },
      { action: 'press', key: 'Enter' },
    ];
  if (step === 'choose_method')
    return [
      {
        action: 'click_described',
        description: 'the option to sign in by entering the password',
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

async function main() {
  const args = runArgs();
  const credential = await getCredential(args.credentialId);
  if (!credential?.login_email || !credential?.login_password) {
    throw new Error(
      `credential ${args.credentialId} missing login_email/login_password`,
    );
  }

  const steps = [];
  const mark = async (name) => {
    steps.push({
      name,
      url: await url(args.session),
      text: await text(args.session),
    });
  };
  const stopped = async (code, detail) => {
    throw Object.assign(
      new Error(
        `${code}: ${detail} at ${await url(args.session)}; steps: ${JSON.stringify(steps, null, INDENT)}`,
      ),
      { steps },
    );
  };

  await mark('start');
  const answeredAt = new Set();
  for (;;) {
    const address = await url(args.session);
    const step = googleStep(address);
    if (step === 'left_google') break;
    const answer = answerFor(step, credential);
    if (!answer) {
      await mark(`google_${step}`);
      await stopped(
        `GOOGLE_SIGN_IN_${step.toUpperCase()}`,
        'Google stopped the sign-in',
      );
    }
    if (answeredAt.has(`${step} ${address}`)) {
      await stopped(
        'GOOGLE_SIGN_IN_STEP_REPEATED',
        `Google still shows the ${step} step after it was answered`,
      );
    }
    answeredAt.add(`${step} ${address}`);
    for (const cmd of answer) await action(args.session, cmd);
    await action(args.session, { action: 'settle' });
    await mark(`google_${step}`);
  }

  if (args.targetUrl) {
    await action(args.session, { action: 'nav', url: args.targetUrl });
    await action(args.session, { action: 'settle' });
    await mark('target_loaded');
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        finalUrl: await url(args.session),
        finalText: await text(args.session),
        steps,
      },
      null,
      INDENT,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack ? error.stack : String(error));
  process.exitCode = exitStatusFor(error);
});
