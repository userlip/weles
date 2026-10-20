// The routes whose trajectory registers an account or signs one in, and so
// leaves a credential behind: the worker runs at most one of them per action,
// account and parameters at a time (a second register would create a second
// account) and never answers their output verbatim.

import { ACTION_NAME, resolveTrajectory } from '../dispatch.js';

/** The verbs of the routes that register an account or sign one in. */
const CREDENTIAL_VERBS: Readonly<Record<string, true>> = {
  register: true,
  login: true,
  ads_login: true,
};

/** Whether `action` routes to a trajectory that registers an account or signs one in. */
export function routeMintsCredential(action: string): boolean {
  const verb = ACTION_NAME.exec(action)?.groups?.verb;
  return (
    verb !== undefined &&
    Object.hasOwn(CREDENTIAL_VERBS, verb) &&
    resolveTrajectory(action) !== null
  );
}
