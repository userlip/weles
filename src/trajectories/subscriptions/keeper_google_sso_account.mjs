// Drive an already-open keeper through Google SSO using a Weles service credential.
// This is for interactive keeper verification, not a one-shot trajectory.
// The sign-in itself is the shared keeper Google driver
// (`_shared/keeper/google_sign_in.mjs`): each step answered once per address,
// a repeated or unanswerable step refused with the steps seen.

import { parseArgs } from 'node:util';
import { keeperRequest, keeperSocket } from '../_shared/keeper/client.mjs';
import { signInThroughKeeper } from '../_shared/keeper/google_sign_in.mjs';
import { getCredential } from '../../lib/service_credentials.mjs';
import { exitStatusFor } from '../../../dist/cli/usage.js';

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

async function main() {
  const args = runArgs();
  const act = async (cmd) => {
    const answer = await keeperRequest(keeperSocket(args.session), cmd);
    if (!answer.ok)
      throw new Error(
        `keeper action ${cmd.action} failed: ${answer.error ? answer.error : 'the keeper gave no reason'}`,
      );
    return answer;
  };
  const credential = await getCredential(args.credentialId);
  if (!credential?.login_email || !credential?.login_password) {
    throw new Error(
      `credential ${args.credentialId} missing login_email/login_password`,
    );
  }

  const steps = await signInThroughKeeper(act, {
    email: credential.login_email,
    password: credential.login_password,
  });
  if (args.targetUrl) {
    await act({ action: 'nav', url: args.targetUrl });
    await act({ action: 'settle' });
  }
  const { url } = await act({ action: 'url' });
  const { result } = await act({
    action: 'eval',
    js: 'document.body.innerText',
  });
  console.log(
    JSON.stringify(
      { ok: true, finalUrl: url, finalText: result, steps },
      null,
      INDENT,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack ? error.stack : String(error));
  process.exitCode = exitStatusFor(error);
});
