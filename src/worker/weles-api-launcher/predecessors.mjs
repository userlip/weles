// The Weles units a host ran beside the one Weles process, retired when that
// process starts as its declared unit.
//
// A host kept several Weles processes: earlier labels of this API
// (com.wisent.weles-admission and before it), the launchd worker job the API
// drove with launchctl (com.wisent.weles-worker), a separate node server for
// the keyword planner (com.wisent.compute.service.weles-keyword-planner-api),
// the checkout-based auto-deploy job and a release cutover service that kept
// restoring a deleted launcher. Their work runs inside this process or belongs
// to the release pipeline. Started by launchd as com.wisent.weles, the one
// unit the Stado catalog names, the API boots each of them out of this user's
// domain and removes its launch agent, so no login or install loads them beside
// it. A system LaunchDaemon of the same name is outside this user's domain and
// is reported, not touched. Run by hand or by a test, nothing is retired.

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DECLARED_UNIT = 'com.wisent.weles';

// The catalog's retired units of Weles, in the same order.
export const PREDECESSORS = Object.freeze([
  'com.wisent.weles-admission',
  'com.wisent.weles-worker',
  'com.wisent.compute.service.weles-keyword-planner-api',
  'com.wisent.compute.service.com.wisent.always-on.weles',
  'com.wisent.always-on.weles-api',
  'com.wisent.compute.service.weles-api',
  'com.wisent.weles-api',
  'com.wisent.weles-auto-deploy',
  'com.wisent.compute.service.weles-release-cutover',
]);

// Whether launchctl accepted the command, and its own words when it did not.
// A launchctl that cannot be started at all is thrown: every answer it would
// have given about the predecessors is unknown, not "absent".
function launchctl(args) {
  try {
    execFileSync('/bin/launchctl', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });
    return { ok: true, detail: null };
  } catch (error) {
    if (error.status == null)
      throw new Error(`/bin/launchctl could not run: ${error.message}`);
    return {
      ok: false,
      detail: `launchctl ${args.join(' ')} exited ${error.status}: ${String(error.stderr).trim()}`,
    };
  }
}

/**
 * Retire every predecessor present in this user's launchd domain when this
 * process is the declared unit; returns the labels it retired.
 */
export function retirePredecessors(environment = process.env) {
  if (
    process.platform !== 'darwin' ||
    environment.XPC_SERVICE_NAME !== DECLARED_UNIT
  )
    return [];
  const domain = `gui/${process.getuid()}`;
  const agents = join(homedir(), 'Library', 'LaunchAgents');
  const retired = [];
  for (const label of PREDECESSORS) {
    const plist = join(agents, `${label}.plist`);
    if (!launchctl(['print', `${domain}/${label}`]).ok && !existsSync(plist)) {
      const daemon = join('/Library/LaunchDaemons', `${label}.plist`);
      if (existsSync(daemon)) {
        console.error(
          `[weles-api] ${label} is a system LaunchDaemon (${daemon}); this user's process cannot retire it and it still runs beside this one`,
        );
      }
      continue;
    }
    const bootout = launchctl(['bootout', `${domain}/${label}`]);
    if (!bootout.ok && launchctl(['print', `${domain}/${label}`]).ok) {
      // Still loaded after a refused bootout: it keeps running beside this
      // process, so it is neither removed nor reported retired.
      console.error(
        `[weles-api] ${label} could not be booted out and still runs beside this one: ${bootout.detail}`,
      );
      continue;
    }
    try {
      rmSync(plist, { force: true });
      console.log(
        `[weles-api] retired ${label}: its work runs in this process`,
      );
    } catch (error) {
      console.error(
        `[weles-api] ${label} is stopped but ${plist} stays: ${error.message}`,
      );
    }
    retired.push(label);
  }
  return retired;
}
