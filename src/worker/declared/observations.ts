// Declared observation: one reviewed trajectory reading one declared origin
// for a declared number of screens.
//
// The declaration names, per observation, its platform, its verb, the origin
// it reads, what it must read there, how many screens it reads and the
// reviewed trajectory; `generic_keeper_task` consumes it. Two failures land at
// admission rather than at execution:
//
//   * an observation nobody declared is refused when it is submitted, and
//   * a declaration naming a missing reviewed trajectory is refused when it
//     is loaded — the whole declaration, not the one run that reached the gap.
//
// A new site is a row in the declaration, not another verb here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { welesRepositoryRoot } from './engagements.js';
import {
  OBSERVATION_DECLARATION_PATH,
  PLACEHOLDER,
  declaredEntry,
  type DeclaredObservation,
} from './observation-entry.js';

export const OBSERVATION_DECLARATION_SCHEMA =
  'wisent.weles-observation-declaration.v1';

/** Submission keys the declaration owns: naming one beside an observation is
 * a second answer to what the run reads and how long it stays. */
const OWNED_BY_DECLARATION: Readonly<Record<string, true>> = Object.freeze({
  url: true,
  objective: true,
  target_url: true,
  target_user: true,
  search_query: true,
  posts_to_browse: true,
});

/**
 * Read and check the whole declaration, or refuse it.
 *
 * Every refusal here is a refusal of the declaration, not of one observation:
 * a build whose declaration names a trajectory that is not in it cannot be
 * trusted to admit any observation, and the operator needs to hear that from
 * the unit that starts rather than from the first caller who guesses right.
 */
export function loadDeclaredObservations(
  repositoryRoot: string = welesRepositoryRoot(),
): Map<string, DeclaredObservation> {
  const path = join(repositoryRoot, OBSERVATION_DECLARATION_PATH);
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${OBSERVATION_DECLARATION_PATH} could not be read: ${reason}`,
    );
  }
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error(`${OBSERVATION_DECLARATION_PATH} must be one JSON object`);
  const declaration = document as Record<string, unknown>;
  if (declaration.schema !== OBSERVATION_DECLARATION_SCHEMA)
    throw new Error(
      `${OBSERVATION_DECLARATION_PATH} must declare schema ${OBSERVATION_DECLARATION_SCHEMA}`,
    );
  const entries = declaration.observations;
  if (!Array.isArray(entries) || !entries.length)
    throw new Error(
      `${OBSERVATION_DECLARATION_PATH} must declare at least one observation`,
    );
  const declared = new Map<string, DeclaredObservation>();
  for (const [index, raw] of entries.entries()) {
    const entry = declaredEntry(raw, index, repositoryRoot);
    if (declared.has(entry.observation))
      throw new Error(
        `${OBSERVATION_DECLARATION_PATH} declares observation ${entry.observation} twice`,
      );
    declared.set(entry.observation, entry);
  }
  return declared;
}

// One read per checkout per process. The declaration is release content, so it
// cannot change under a running unit, and admission stays a lookup: nothing on
// the submission path touches the filesystem.
const cached = new Map<string, Map<string, DeclaredObservation>>();

export function declaredObservations(
  repositoryRoot: string = welesRepositoryRoot(),
): Map<string, DeclaredObservation> {
  const known = cached.get(repositoryRoot);
  if (known) return known;
  const loaded = loadDeclaredObservations(repositoryRoot);
  cached.set(repositoryRoot, loaded);
  return loaded;
}

/**
 * Admission: the declared observation a submission names, or the refusal a
 * caller gets instead of a run.
 */
export function admitObservation(
  named: unknown,
  repositoryRoot: string = welesRepositoryRoot(),
): DeclaredObservation {
  if (typeof named !== 'string' || !named.trim())
    throw new Error(
      'observation must name a declared observation as <platform>.<verb>',
    );
  const observation = named.trim();
  const declared = declaredObservations(repositoryRoot).get(observation);
  if (!declared)
    throw new Error(
      `observation ${observation} is not declared in ${OBSERVATION_DECLARATION_PATH}`,
    );
  return declared;
}

/**
 * The origin the run navigates to: the declared one, with every placeholder it
 * carries filled from the submission. A placeholder the submission does not
 * name is refused here rather than navigated to as the literal `{handle}`.
 */
export function resolveObservationOrigin(
  declared: DeclaredObservation,
  params: Record<string, unknown>,
): string {
  return declared.origin.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name];
    if (typeof value !== 'string' || !value.trim())
      throw new Error(
        `observation ${declared.observation} reads ${declared.reads} and needs ${name}`,
      );
    // A name a caller types carries the site's own prefix — @handle, r/sub,
    // u/name — and is stripped here, once, and only for a name: a search
    // query is whatever the caller meant, prefix and all.
    const trimmed = value.trim();
    const bare =
      name === 'query'
        ? trimmed
        : trimmed
            .replace(/^@+/, '')
            .replace(/^\/?[ru]\//, '')
            .replace(/\/+$/, '');
    return encodeURIComponent(bare);
  });
}

/**
 * What `generic_keeper_task` admits, translated into the env its child reads.
 *
 * This is the whole admission step for the capability, and it runs in the
 * dispatcher, before anything is spawned. A run reads either one declared
 * observation or the objective the keeper task was given, never both — the
 * declaration owns the origin and the budget, so a submission that also names
 * one is two answers to "what does this read".
 */
export function applyKeeperTaskEnv(
  params: Record<string, unknown>,
  trajPath: string,
  env: Record<string, string>,
): void {
  if (!trajPath.endsWith('/generic/keeper_task.mjs')) return;
  const named = params.observation;
  if (named === undefined) return;
  const owned = Object.keys(OWNED_BY_DECLARATION).find(
    (key) => params[key] !== undefined,
  );
  if (owned !== undefined)
    throw new Error(
      `generic_keeper_task takes a declared observation or ${owned}, not both`,
    );
  const declared = admitObservation(named);
  env.GENERIC_OBSERVATION = declared.observation;
  env.GENERIC_OBSERVATION_TRAJECTORY = declared.trajectory;
  env.GENERIC_OBSERVATION_ORIGIN = resolveObservationOrigin(declared, params);
  env.GENERIC_OBSERVATION_READS = declared.reads;
  env.GENERIC_OBSERVATION_SCROLLS = String(declared.dwell.scrolls);
  env.PLATFORM = declared.platform;
  env.VERB = declared.verb;
  delete env.GENERIC_TASK_URL;
  delete env.GENERIC_TASK_OBJECTIVE;
}
