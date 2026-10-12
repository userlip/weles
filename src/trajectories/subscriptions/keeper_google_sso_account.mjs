// Drive an already-open keeper through Google SSO using a Weles service credential.
// This is for interactive keeper verification, not a one-shot trajectory.

import { keeperRequest, keeperSocket } from '../_shared/keeper/client.mjs';
import { getCredential } from '../../lib/service_credentials.mjs';
import { exitStatusFor } from '../../../dist/cli/usage.js';

function parseArgs() {
  const out = {
    session: process.env.SESSION || '',
    credentialId: '',
    targetUrl: '',
  };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--session') out.session = process.argv[++i] || '';
    else if (arg === '--credential-id')
      out.credentialId = process.argv[++i] || '';
    else if (arg === '--target-url') out.targetUrl = process.argv[++i] || '';
    else throw new Error(`unknown arg: ${arg}`);
  }
  if (!out.session) throw new Error('missing --session or SESSION');
  if (!out.credentialId) throw new Error('missing --credential-id');
  return out;
}

async function action(session, cmd) {
  const answer = await keeperRequest(keeperSocket(session), cmd);
  if (!answer.ok)
    throw new Error(answer.error || `keeper action failed: ${cmd.action}`);
  return answer;
}

async function text(session) {
  const res = await action(session, {
    action: 'eval',
    js: 'document.body.innerText',
  });
  return String(res.result || '');
}

async function url(session) {
  const res = await action(session, { action: 'url' });
  return String(res.url || '');
}

/**
 * Google's sign-in steps, by the path Google serves each on: where the page
 * is says which step it is, whatever language its words are in.
 */
const GOOGLE_STEPS = [
  { step: 'email', path: /\/signin\/identifier$/ },
  { step: 'password', path: /\/challenge\/pwd$/ },
  { step: 'choose_method', path: /\/challenge\/selection$/ },
  { step: 'blocked', path: /\/challenge\/recaptcha$|^\/sorry\// },
  { step: 'consent', path: /\/signin\/oauth\/|\/oauthconsent$/ },
];

function googleStep(address) {
  const page = new URL(address);
  if (page.hostname !== 'accounts.google.com') return 'left_google';
  const known = GOOGLE_STEPS.find(({ path }) => path.test(page.pathname));
  return known ? known.step : 'unknown';
}

const INDENT = '  ';

async function main() {
  const args = parseArgs();
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

  await mark('start');
  // Each step Google shows is answered until the browser leaves Google; a
  // step that does not move on is answered again, as a person would.
  for (;;) {
    const step = googleStep(await url(args.session));
    if (step === 'left_google') break;
    if (step === 'email') {
      await action(args.session, {
        action: 'fill',
        selector: 'input[type="email"]',
        text: credential.login_email,
      });
      await action(args.session, { action: 'press', key: 'Enter' });
    } else if (step === 'password') {
      await action(args.session, {
        action: 'fill',
        selector: 'input[type="password"]',
        text: credential.login_password,
      });
      await action(args.session, { action: 'press', key: 'Enter' });
    } else if (step === 'choose_method') {
      await action(args.session, {
        action: 'click_described',
        description: 'the option to sign in by entering the password',
      });
    } else if (step === 'consent') {
      // A consent screen that cannot be answered leaves the account signed
      // out of the target; the keeper's own refusal fails the run.
      await action(args.session, {
        action: 'click_described',
        description:
          'the button that grants the application the access it asks for and continues to it',
      });
    } else {
      await mark(`google_${step}`);
      throw Object.assign(
        new Error(
          `GOOGLE_SIGN_IN_${step.toUpperCase()}: Google stopped the sign-in at ${await url(args.session)}; steps: ${JSON.stringify(steps, null, INDENT)}`,
        ),
        { steps },
      );
    }
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
