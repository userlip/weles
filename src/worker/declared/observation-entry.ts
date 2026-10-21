// One entry of the observation declaration, checked: its name, origin, what it
// reads there, its dwell budget and the reviewed trajectory it runs. Every
// refusal names the entry and what it lacks.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Where the declaration lives, relative to the checkout it belongs to. */
export const OBSERVATION_DECLARATION_PATH =
  'src/worker/deploy/weles-observation-declaration.json';

/** Reviewed trajectories live here, and a declaration may name nothing else. */
const TRAJECTORY_ROOT = 'src/trajectories/';

/** `<platform>.<verb>` — a declaration name, deliberately not an action name. */
const OBSERVATION_NAME = /^[a-z][a-z\d]*\.[a-z][a-z\d_]*$/;

/**
 * What a run must read, and the origin placeholder that proves the declared
 * origin can show it: an origin that carries no query cannot produce search
 * results however the row is labelled, and one that carries no handle cannot
 * produce a profile.
 */
const READS: Record<string, string> = {
  feed: '',
  notifications: '',
  search_results: 'query',
  profile: 'handle',
};

/** Placeholders an origin may carry; a submission names each one by this key. */
const PLACEHOLDERS: Record<string, true> = {
  query: true,
  handle: true,
  subreddit: true,
};

/** One `{name}` placeholder in a declared origin. */
export const PLACEHOLDER = /\{(?<name>[a-z_]+)\}/g;

export type ObservationDwell = {
  readonly scrolls: number;
  readonly ms: readonly [number, number];
};

export type DeclaredObservation = {
  readonly observation: string;
  readonly platform: string;
  readonly verb: string;
  readonly origin: string;
  readonly reads: string;
  readonly dwell: ObservationDwell;
  readonly trajectory: string;
};

/** The entry's named text, trimmed; absent when it is missing, not text or blank. */
function field(
  entry: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = entry[name];
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim();
}

/** A whole number that is not negative. */
function wholeCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) === value
  );
}

/** Whole scrolls, and a range of milliseconds that starts above nothing. */
function dwellOf(raw: unknown): ObservationDwell | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { scrolls, ms } = raw as Record<string, unknown>;
  if (!wholeCount(scrolls) || !Array.isArray(ms)) return undefined;
  const [low, high, ...beyond]: unknown[] = ms;
  if (beyond.length || !wholeCount(low) || !wholeCount(high)) return undefined;
  if (!low || high < low) return undefined;
  return { scrolls, ms: [low, high] };
}

/** The placeholder names a declared origin carries. */
export function placeholdersOf(origin: string): string[] {
  return [...origin.matchAll(PLACEHOLDER)].flatMap((match) =>
    match.groups ? [match.groups.name] : [],
  );
}

/**
 * The declared observation one entry states, or the refusal of the whole
 * declaration that names the entry and what it lacks.
 */
export function declaredEntry(
  raw: unknown,
  index: number,
  repositoryRoot: string,
): DeclaredObservation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(
      `${OBSERVATION_DECLARATION_PATH} entry ${index} is not an object`,
    );
  const entry = raw as Record<string, unknown>;
  const observation = field(entry, 'observation');
  const platform = field(entry, 'platform');
  const verb = field(entry, 'verb');
  const origin = field(entry, 'origin');
  const reads = field(entry, 'reads');
  const trajectory = field(entry, 'trajectory');
  if (!observation || !platform || !verb || !origin || !reads || !trajectory)
    throw new Error(
      `${OBSERVATION_DECLARATION_PATH} entry ${index} must name observation, platform, verb, origin, reads and trajectory`,
    );
  if (!OBSERVATION_NAME.test(observation))
    throw new Error(
      `${OBSERVATION_DECLARATION_PATH} declares the malformed observation name ${observation}`,
    );
  if (observation !== `${platform}.${verb}`)
    throw new Error(
      `${OBSERVATION_DECLARATION_PATH} declares observation ${observation} for platform ${platform} and verb ${verb}`,
    );
  if (!Object.hasOwn(READS, reads))
    throw new Error(
      `declared observation ${observation} must read one of ${Object.keys(READS).join(', ')}, not ${reads}`,
    );
  if (!origin.startsWith('https://'))
    throw new Error(
      `declared observation ${observation} must name an https origin, not ${origin}`,
    );
  const carried = placeholdersOf(origin);
  const unknown = carried.find((name) => !Object.hasOwn(PLACEHOLDERS, name));
  if (unknown !== undefined)
    throw new Error(
      `declared observation ${observation} names the unknown origin placeholder {${unknown}}`,
    );
  const required = READS[reads];
  if (required && !carried.includes(required))
    throw new Error(
      `declared observation ${observation} reads ${reads}, so its origin must carry {${required}}`,
    );
  const dwell = dwellOf(entry.dwell);
  if (!dwell)
    throw new Error(
      `declared observation ${observation} must declare a dwell budget of whole scrolls and an ascending ms range`,
    );
  if (!trajectory.startsWith(TRAJECTORY_ROOT) || trajectory.includes('..'))
    throw new Error(
      `declared observation ${observation} must name a reviewed trajectory under ${TRAJECTORY_ROOT}, not ${trajectory}`,
    );
  if (!existsSync(join(repositoryRoot, trajectory)))
    throw new Error(
      `declared observation ${observation} names a missing reviewed trajectory: ${trajectory}`,
    );
  return { observation, platform, verb, origin, reads, dwell, trajectory };
}
