// The analytics-service actions: the ones that resolve to one parametric
// runner instead of one trajectory each. They are every action the service's
// catalog declares (analytics-service/catalog/<platform>.json beside the
// runner), read from those declarations, so the worker and the trajectory
// cannot name different actions or inputs.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { welesRepositoryRoot } from '../declared/engagements.js';

export const ANALYTICS_SERVICE_PATH =
  'src/trajectories/_shared/analytics-service.mjs';

type AnalyticsCatalog = {
  actions: Record<string, { inputs: Record<string, string> }>;
};

/** Every catalog action with the input names it declares, required or optional. */
export function analyticsCatalogActions(): Record<string, string[]> {
  const dir = path.resolve(
    welesRepositoryRoot(),
    path.dirname(ANALYTICS_SERVICE_PATH),
    'analytics-service',
    'catalog',
  );
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) =>
        Object.entries(
          (
            JSON.parse(
              readFileSync(path.join(dir, file), 'utf8'),
            ) as AnalyticsCatalog
          ).actions,
        ).map(([name, action]) => [name, Object.keys(action.inputs)]),
      ),
  );
}
