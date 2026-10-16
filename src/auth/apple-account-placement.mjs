// Apple two-factor placement and transport.
//
// Stado resolves both ends from the live registry: the macOS session that holds
// the account and the worker whose Weles capability broker will redeem the code.
// The preflight opens no prompt; the relay captures only after Apple has asked
// for 2FA and returns a receipt with no digits.

import { spawnSync } from 'node:child_process';
import { stadoBinary } from '../_shared/skarbiec-runtime.mjs';

const EXIT_SUCCESS = 0; // https://pubs.opengroup.org/onlinepubs/9799919799/functions/exit.html EXIT_SUCCESS

/**
 * One Stado command's JSON answer; a failure names the command and says what
 * Stado said on stderr. Its stdout is never quoted: an issue-capabilities
 * answer carries capabilities, so only its length is named.
 */
function readStadoJson(argv) {
  const command = `stado ${argv.join(' ')}`;
  const result = spawnSync(stadoBinary(), argv, { encoding: 'utf8' });
  if (result.error) {
    throw new Error(`${command} could not be run: ${result.error.message}`);
  }
  if (result.status !== EXIT_SUCCESS) {
    let ended = `exited ${result.status}`;
    if (result.status === null) ended = `ended on signal ${result.signal}`;
    const said = result.stderr.trim();
    throw new Error(
      `${command} ${ended}: ${said === '' ? 'it printed nothing on stderr' : said}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `${command} printed ${result.stdout.length} characters that are not JSON: ${error.message}`,
    );
  }
}

function runChallengeCommand(argv, expectedStatus) {
  const report = readStadoJson(argv);
  if (
    !report ||
    report.status !== expectedStatus ||
    typeof report.holder !== 'string' ||
    !report.holder ||
    typeof report.user !== 'string' ||
    !report.user ||
    typeof report.destination !== 'string' ||
    !report.destination
  ) {
    throw new Error(`Stado did not confirm Apple challenge ${expectedStatus}`);
  }
  return report;
}

function relayArguments(identity, authorizationId) {
  if (!identity) throw new Error('an Apple account identity is required');
  if (!authorizationId)
    throw new Error('an Apple authorization id is required');
  return [
    'identity',
    'relay-challenge',
    '--provider',
    'apple',
    '--identity',
    identity,
    '--authorization-id',
    authorizationId,
    '--json',
  ];
}

export function preflightAppleChallengeRelay(identity, authorizationId) {
  return runChallengeCommand(
    [...relayArguments(identity, authorizationId), '--preflight'],
    'ready',
  );
}

export function relayAppleChallenge(identity, authorizationId) {
  return runChallengeCommand(
    relayArguments(identity, authorizationId),
    'stored',
  );
}

export function issueAppleLoginCapabilities({
  executionHost,
  executionAgent,
  authorizationId,
  ttlSeconds,
}) {
  const report = readStadoJson([
    'identity',
    'issue-capabilities',
    '--provider',
    'apple',
    '--target',
    executionHost,
    '--agent',
    executionAgent,
    '--authorization-id',
    authorizationId,
    '--ttl-seconds',
    String(ttlSeconds),
    '--json',
  ]);
  if (
    !report ||
    report.status !== 'issued' ||
    report.target !== executionHost ||
    !report.capabilities ||
    typeof report.capabilities !== 'object'
  ) {
    throw new Error(
      'Stado did not issue Apple capabilities on the execution host',
    );
  }
  return report.capabilities;
}
