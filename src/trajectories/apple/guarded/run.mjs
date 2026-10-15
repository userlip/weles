// One guarded Apple run: the identity the worker hands it (the authorization
// guard, the Apple account item, the run id), the three one-use Skarbiec
// capabilities (email, password, 2FA) bound to that guard, the challenge route
// checked before a browser opens or a password attempt is spent, and the
// capabilities cancelled when the run ends, spent or not. Stado owns placement
// and execution.
import { randomUUID } from 'node:crypto';
import { WSession } from '../../../../dist/session/wsession.js';
import { cancelCapability } from '../../../../dist/utils/capability.js';
import { parseAppleLoginCapabilities } from '../../../../dist/utils/identity/apple-login-capabilities.js';
import { getSocialAccount } from '../../../../dist/utils/credentials.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { preflightAppleChallengeRelay } from '../../../auth/apple-account-placement.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';

// An identifier's shape: every hex digit stands as one placeholder, so a UUID
// is compared with the shape of a freshly made one, and a Stado queue job id
// with that UUID's first group.
const shapeOf = (id) => id.replace(/[\da-f]/gi, 'x');
const UUID_SHAPE = shapeOf(randomUUID());
const [QUEUE_JOB_SHAPE] = UUID_SHAPE.split('-');

function runIdentity(prefix) {
  const guardId = statedText(['APPLE_AUTH_GUARD_ID'], 'the authorization guard this Apple run spends its capabilities under').toLowerCase();
  if (shapeOf(guardId) !== UUID_SHAPE) throw new Error(`${prefix} APPLE_AUTH_GUARD_ID must be a UUID`);
  // The item the worker selected by role; its id carries no meaning, only shape.
  const accountId = statedText(['WELES_LOGIN_ITEM'], 'the item the worker selected for the Apple account role');
  if (!/^[\dA-Za-z][\w.:-]*$/.test(accountId)) throw new Error(`${prefix} WELES_LOGIN_ITEM is not an item id`);
  // A Stado queue job id, or the UUID the Weles API names a run with and
  // writes into ACTION_LOG_ID after params are mapped: both name one run.
  const runId = statedText(['ACTION_LOG_ID'], 'the id Stado or the Weles API gave this run').toLowerCase();
  if (shapeOf(runId) !== UUID_SHAPE && shapeOf(runId) !== QUEUE_JOB_SHAPE)
    throw new Error(`${prefix} ACTION_LOG_ID must be a Stado job id or a Weles run UUID`);
  return { guardId, accountId };
}

/** The Apple ID the account holder signs in with: its stored email, else its username. */
async function appleIdentity() {
  const account = await getSocialAccount('apple');
  if (!account) throw new Error('APPLE_ACCOUNT_MISSING: no Apple account in the accounts store');
  const named = account.metadata && account.metadata.email ? account.metadata.email : account.username;
  if (!named) throw new Error(`APPLE_ACCOUNT_UNNAMED: Apple account ${account.id} has neither an email nor a username`);
  return named.trim();
}

async function cancelAll(capabilities, guardId) {
  const refs = [capabilities.email, capabilities.password, capabilities.two_factor.capability];
  const outcomes = await Promise.allSettled(refs.map((ref) => cancelCapability(ref.capability_id, guardId)));
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason);
  if (failures.length)
    throw new AggregateError(failures, `capability cancellation unconfirmed: ${failures.map((e) => e.message).join('; ')}`);
}

/**
 * Runs `act(session, guard)` as one guarded Apple run; `guard` holds the
 * capabilities, the guard id and the Apple identity, and `act` answers what it
 * observed. The session is closed and the capabilities cancelled whatever the
 * outcome; the run passes only when all three succeed, and otherwise every
 * failure among them is reported and the exit status follows it.
 */
export async function runGuarded({ label, prefix, act }) {
  const failures = [];
  let observed;
  let capabilities;
  let guardId;
  let s;
  try {
    const run = runIdentity(prefix);
    guardId = run.guardId;
    console.log(`${prefix} account ${run.accountId}`);
    capabilities = parseAppleLoginCapabilities(process.env.APPLE_LOGIN_CAPABILITIES_JSON, guardId);
    const identity = await appleIdentity();
    // Reads state only and opens no native prompt.
    const route = preflightAppleChallengeRelay(identity, guardId);
    console.log(`${prefix} Apple challenge route ${route.holder}/${route.user} -> ${route.destination}`);
    s = await WSession.start({ label, headless: process.env.WELES_HEADLESS === '1' });
    observed = await act(s, { capabilities, guardId, identity });
  } catch (error) {
    failures.push(error);
  }
  if (s) await s.close().catch((error) => failures.push(error));
  if (capabilities) await cancelAll(capabilities, guardId).catch((error) => failures.push(error));
  const [first, ...more] = failures;
  if (!first) {
    console.log(`PASS: ${observed}`);
    return;
  }
  const failure = more.length ? new AggregateError(failures, failures.map((e) => e.message).join('; ')) : first;
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = exitStatusFor(failure);
}
