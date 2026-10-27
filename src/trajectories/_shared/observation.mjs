/**
 * The declared observation this run was admitted with.
 *
 * Admission resolved src/worker/deploy/weles-observation-declaration.json in
 * the dispatcher and put the result in the child's env, so the origin a run
 * reads and the screens it reads are declaration content, not a table inside
 * a trajectory. Each screen is read once the page has settled after the
 * wheel; no clock paces it. A reviewed observation trajectory is reachable
 * only through that admission step, so an absent variable is a broken caller,
 * not a default to invent: every one of these refuses instead of guessing.
 */

function required(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(
      `${name} is required: an observation trajectory runs only from a declared observation`,
    );
  }
  return raw.trim();
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
  return {
    observation,
    platform,
    verb,
    origin: required('GENERIC_OBSERVATION_ORIGIN'),
    reads: required('GENERIC_OBSERVATION_READS'),
    scrolls,
  };
}
