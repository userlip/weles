// Resolve account actions named <platform>_<verb> to reviewed trajectories.
// Paid advertising and other action routes live in separate tables; declared
// engagements, observations and analytics services are resolved separately.
// An unknown action returns null and cannot start a trajectory.

import { ANALYTICS_SERVICE_ACTIONS } from './params/analytics-actions.js';
import { STANDARD_ROUTES } from './dispatch/standard-routes.js';
import { PAID_ROUTES } from './dispatch/paid-routes.js';

// The env translator is ./params-to-env.ts, re-exported here so
// `dist/worker/dispatch.js` stays the one module the API server, the Stado
// runner and the published measurement import.
export { paramsToEnv } from './params/params-to-env.js';

const analyticsServicePath = 'src/trajectories/_shared/analytics-service.mjs';

export function resolveTrajectory(action: string): string | null {
  const firstUnderscore = action.indexOf('_');
  if (firstUnderscore < 0) return null;
  if (ANALYTICS_SERVICE_ACTIONS.has(action)) return analyticsServicePath;
  const plat = action.slice(0, firstUnderscore);
  const verb = action.slice(firstUnderscore + 1);
  // Cross-login: collapse every login_via_<provider> verb onto a single
  // parametric runner. The provider is parsed out in paramsToEnv into PROVIDER.
  if (verb.startsWith('login_via_')) {
    const router = STANDARD_ROUTES['login_via'];
    return router ? router(plat) : null;
  }
  const router = STANDARD_ROUTES[verb] ?? PAID_ROUTES[verb];
  return router ? router(plat) : null;
}

export {
  validateAccountSecurityParams,
  validateAppPasswordParams,
} from './params-to-env/account-and-task-admission.js';
