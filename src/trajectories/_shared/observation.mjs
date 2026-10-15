/**
 * The declared observation this run was admitted with.
 *
 * Admission resolved src/worker/deploy/weles-observation-declaration.json in
 * the dispatcher and put the result in the child's env, so the origin a run
 * reads and the dwell budget it spends are declaration content, not a table
 * inside a trajectory. A reviewed observation trajectory is reachable only
 * through that admission step, so an absent variable is a broken caller, not
 * a default to invent: every one of these refuses instead of guessing.
 */

function required(name) {
  const raw = process.env[name];
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) {
    throw new Error(
      `${name} is required: an observation trajectory runs only from a declared observation`,
    );
  }
  return value;
}

/** A whole number written in decimal digits, or NaN. */
function whole(text) {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function declaredObservation() {
  const observation = required('GENERIC_OBSERVATION');
  const [platform, verb] = observation.split('.');
  const scrolls = whole(required('GENERIC_OBSERVATION_SCROLLS'));
  if (!Number.isInteger(scrolls)) {
    throw new Error(
      `GENERIC_OBSERVATION_SCROLLS must be a whole scroll budget, not ${process.env.GENERIC_OBSERVATION_SCROLLS}`,
    );
  }
  // An ascending range: the shortest and the longest dwell, both positive.
  const [shortest, longest, ...beyond] = required(
    'GENERIC_OBSERVATION_DWELL_MS',
  )
    .split(',')
    .map(whole);
  if (
    beyond.length ||
    !Number.isInteger(shortest) ||
    !Number.isInteger(longest) ||
    !(shortest > 0) ||
    longest < shortest
  ) {
    throw new Error(
      `GENERIC_OBSERVATION_DWELL_MS must be an ascending millisecond range, not ${process.env.GENERIC_OBSERVATION_DWELL_MS}`,
    );
  }
  return {
    observation,
    platform,
    verb,
    origin: required('GENERIC_OBSERVATION_ORIGIN'),
    reads: required('GENERIC_OBSERVATION_READS'),
    scrolls,
    dwellMs: [shortest, longest],
  };
}
