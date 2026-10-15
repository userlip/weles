// How the action name itself becomes env for the table-driven trajectories.
//
// The analytics-service family and the cross-login family share one program per
// family and one parametric verb table inside it: the run learns which platform
// and which verb it is from PLATFORM/VERB/SERVICE_ACTION or PLATFORM/PROVIDER,
// not from a trajectory file of its own. Everything here therefore reads
// `action`, not just `params`.
//
// It is separate because it changes for exactly one reason: a new tabular verb
// arrives — another analytics platform, another OAuth provider pair — and no
// new trajectory file is written. That is a different reason to change than the
// Apple requirements in ./apple-actions.ts, which move when Apple's sign-in and
// evidence rules move.

import { analyticsCatalogActions } from '../params/analytics-actions.js';

/**
 * The inputs `action` declares in the analytics service's catalog, the same
 * declarations the trajectory refuses a run by. An action no catalog declares
 * is refused here, before anything is spawned.
 */
function declaredAnalyticsInputs(action: string): string[] {
  const actions = analyticsCatalogActions();
  if (!Object.hasOwn(actions, action))
    throw new Error(`analytics action ${action} is declared in no analytics-service catalog`);
  return actions[action];
}

export function applyActionNameDispatch(
  params: Record<string, unknown>,
  action: string,
  trajPath: string,
  env: Record<string, string>,
): void {
  if (trajPath.endsWith('/_shared/analytics-service.mjs')) {
    const named = /^(?<platform>[^_]+)_(?<verb>.+)$/.exec(action);
    if (named?.groups) {
      env.PLATFORM = named.groups.platform;
      env.VERB = named.groups.verb;
      env.SERVICE_ACTION = action;
    }
    // Each declared input goes over under its own name, from the param of the
    // same name in lower case; nothing else in params reaches the child's
    // environment.
    for (const name of declaredAnalyticsInputs(action)) {
      const value = params[name.toLowerCase()];
      if (value === undefined || value === null) continue;
      env[name] = typeof value === 'string' ? value : JSON.stringify(value);
    }
    if (
      params.confirm === true ||
      params.write_confirm === true ||
      params.confirm === '1' ||
      params.write_confirm === '1'
    ) {
      env.WRITE_CONFIRM = '1';
    }
  }
  // Cross-login parametric dispatch: <platform>_login_via_<provider>
  // → set PLATFORM + PROVIDER env so cross_login/run.mjs can table-lookup
  // the target URL + OAuth-button regex without one-trajectory-file-per-pair.
  if (trajPath.endsWith('/cross_login/run.mjs')) {
    const named = /^(?<platform>[a-z]+)_login_via_(?<provider>[a-z]+)$/.exec(action);
    if (named?.groups) {
      env.PLATFORM = named.groups.platform;
      env.PROVIDER = named.groups.provider;
    }
  }
}
