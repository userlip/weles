// What a credential run is, what it failed at, and what it saved.
//
// A register or login trajectory is not an ordinary run: it leaves a
// credential behind, so the general answer path must never return its output
// verbatim. Whether a run is one is the route's own declaration
// (dist/worker/dispatch/credential-routes.js), and it decides both how the run
// is coalesced and how it is answered.
//
// The other two are the only things a caller may learn about such a run.
// Failure is the trajectory's own AUTH_FAILURE marker (or the acquisition
// record a scoped Skarbiec read writes), plus the last declared stage, because
// arbitrary failure text from a browser session is exactly where a password
// ends up; a failure that carries neither is reported as unreported, not as a
// generic one. Success is the account item the trajectory saved to Skarbiec
// (WSession.saveAccount writes account.json beside its recordings), never a
// tuple guessed from the printed result.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { RECORDINGS_ROOT } from '../configuration.mjs';
import { REPO } from '../release-identity.mjs';

const { routeMintsCredential } = await import(
  `${REPO}/dist/worker/dispatch/credential-routes.js`
);

export function isCredentialTrajectory(action) {
  return routeMintsCredential(action);
}

const AUTH_FAILURE = 'AUTH_FAILURE ';
const STAGE = /^STEP (?<stage>[a-z][a-z\d_-]*)$/gm;
// The one machine record both acquisition readers write
// (src/secrets/scoped-service/acquisition-failure.ts acquisitionRecord and
// src/_shared/scoped-secrets.mjs): nothing is read from the sentence around it.
const ACQUISITION_RECORD =
  /\[skarbiec_acquisition item=(?<item>[A-Za-z\d._-]+) field=(?<field>[A-Za-z\d._-]+) consumer=(?<consumer>[A-Za-z\d._-]+)(?: reason=(?<reason>[a-z_]+))?\]/;

/** The last AUTH_FAILURE marker of `stderr` as the failure it states, or why it states none. */
function markedFailure(marker) {
  let failure;
  let unreadable;
  try {
    failure = JSON.parse(marker.slice(AUTH_FAILURE.length));
  } catch (error) {
    unreadable = error.message;
  }
  if (unreadable !== undefined)
    return { code: 'auth_failure_unreadable', detail: unreadable };
  if (
    typeof failure?.code === 'string' &&
    typeof failure.stage === 'string' &&
    typeof failure.message === 'string'
  )
    return failure;
  return {
    code: 'auth_failure_unreadable',
    detail: 'the AUTH_FAILURE marker lacks a string code, stage or message',
  };
}

export function credentialFailure(out) {
  const stderr = String(out.stderr_tail);
  const [marker] = stderr
    .split('\n')
    .filter((line) => line.startsWith(AUTH_FAILURE))
    .reverse();
  if (marker) return markedFailure(marker);
  const [stage] = [...stderr.matchAll(STAGE)]
    .map((match) => match.groups.stage)
    .reverse();
  const withStage = (failure) => (stage ? { ...failure, stage } : failure);
  const record = stderr.match(ACQUISITION_RECORD)?.groups;
  if (record) {
    return withStage({
      code: 'skarbiec_acquisition_failed',
      item: record.item,
      field: record.field,
      consumer: record.consumer,
      ...(record.reason ? { reason: record.reason } : {}),
    });
  }
  return withStage({ code: 'auth_failure_unreported' });
}

/**
 * The account items run `runId` saved to Skarbiec: each account.json
 * WSession.saveAccount wrote under the run's recordings, as
 * { item, platform, username }.
 */
export function savedAccounts(runId) {
  const root = join(RECORDINGS_ROOT, runId);
  if (!existsSync(root)) return [];
  const directories = [
    root,
    ...readdirSync(root)
      .map((name) => join(root, name))
      .filter((path) => statSync(path).isDirectory()),
  ];
  return directories
    .map((directory) => join(directory, 'account.json'))
    .filter((path) => existsSync(path))
    .map((path) => {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      return {
        item: saved.item,
        platform: saved.platform,
        username: saved.username,
      };
    });
}
