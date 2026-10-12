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

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { welesRepositoryRoot } from '../declared/engagements.js';

type AnalyticsCatalog = {
  actions: Record<string, { inputs: Record<string, string> }>;
};

/**
 * The inputs `action` declares in the analytics service's catalog
 * (analytics-service/catalog/<platform>.json beside the trajectory), the same
 * declarations the trajectory refuses a run by. An action no catalog declares
 * is refused here, before anything is spawned.
 */
function declaredAnalyticsInputs(trajPath: string, action: string): string[] {
  const dir = path.resolve(
    welesRepositoryRoot(),
    path.dirname(trajPath),
    'analytics-service',
    'catalog',
  );
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const catalog = JSON.parse(
      readFileSync(path.join(dir, file), 'utf8'),
    ) as AnalyticsCatalog;
    if (Object.hasOwn(catalog.actions, action))
      return Object.keys(catalog.actions[action].inputs);
  }
  throw new Error(
    `analytics action ${action} is declared in no catalog under ${dir}`,
  );
}

export function applyActionNameDispatch(
  params: Record<string, unknown>,
  action: string,
  trajPath: string,
  env: Record<string, string>,
): void {
  if (trajPath.endsWith('/_shared/analytics-service.mjs')) {
    const underscore = action.indexOf('_');
    if (underscore > 0) {
      env.PLATFORM = action.slice(0, underscore);
      env.VERB = action.slice(underscore + 1);
      env.SERVICE_ACTION = action;
    }
    // Each declared input goes over under its own name, from the param of the
    // same name in lower case; nothing else in params reaches the child's
    // environment.
    for (const name of declaredAnalyticsInputs(trajPath, action)) {
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
    const m = action.match(/^([a-z]+)_login_via_([a-z]+)$/);
    if (m) {
      env.PLATFORM = m[1];
      env.PROVIDER = m[2];
    }
  }
}
