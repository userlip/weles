// TikTok signup by email, through the stated proxy: each attempt registers a
// fresh identity in a fresh session (tiktok/register/attempt.mjs), and the
// attempts stop at the first account TikTok creates, at a refusal TikTok
// gives the session itself, or at MAX_RETRIES, the caller's bound on how many
// identities one run may spend. Every failed attempt is named in the run's
// failure with its cause.
//
// Env: MAX_RETRIES (required), PROXY_URL (required; 'direct' for none).
// The session is Chromium: the human pointer moves through Chromium's
// devtools input events.
import { WSession } from '../../../dist/session/wsession.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { generateIdentity } from '../../../dist/utils/identity/identity.js';
import { registrationPassword } from '../../../dist/utils/identity/password.js';
import { autoBindCharacter } from '../lib/character-bind.mjs';
import { installNetworkLogger } from '../lib/tiktok-register-helpers.mjs';
import { statedCount, statedProxy } from '../_shared/inputs/stated.mjs';
import { registerOnce } from './register/attempt.mjs';

const maxAttempts = statedCount('MAX_RETRIES', 'how many fresh identities this registration may try');
const proxy = statedProxy('the TikTok signup');

/** One attempt in its own session; answers the saved account. */
async function attempt() {
  const id = await generateIdentity('tiktok');
  // One character of every class at the vault policy's length, no fixed
  // prefix (TikTok decodes the body; a recurring prefix is a counter key).
  const password = registrationPassword();
  console.log(`[test] identity=${id.username} <${id.email}>`);
  const s = await WSession.start({
    label: 'tiktok_register',
    proxy,
    targetHost: 'www.tiktok.com',
    browser: 'chromium',
  });
  try {
    installNetworkLogger(s);
    const username = await registerOnce(s, id, password);
    // The account exists from here on: a failure to record it or bind its
    // character ends the run instead of creating another identity's account.
    try {
      console.log(`[test] ${await s.saveAccount('tiktok', { username, email: id.email, password })}`);
      console.log(`[bind] ${JSON.stringify(await autoBindCharacter(username, 'tiktok'))}`);
    } catch (cause) {
      throw Object.assign(
        new Error(`TIKTOK_ACCOUNT_NOT_RECORDED: TikTok created ${username}; saving it or binding its character failed: ${cause.message}`, { cause }),
        { accountCreated: true },
      );
    }
    return username;
  } finally {
    await s.close();
  }
}

try {
  const failures = [];
  let username;
  while (!username) {
    if (failures.length === maxAttempts)
      throw new Error(`TIKTOK_REGISTER_FAILED: every attempt failed: ${failures.join(' | ')}`);
    try {
      username = await attempt();
    } catch (error) {
      if (error.sessionRefused || error.accountCreated) throw error;
      failures.push(error.message);
      console.log(`[test] attempt failed: ${error.message}`);
    }
  }
  console.log(`PASS: ${username}`);
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
}
