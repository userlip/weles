/**
 * The names of the environment variables a run had set, sorted, without their
 * values. No reading of a variable's name tells a secret from a setting
 * (AWS_ACCESS_KEY_ID passed every name pattern that was tried), and nothing
 * reads a recorded value back: a run is reproduced from its declared request,
 * not from its process environment. So the values never reach a recording.
 */
export function environmentNames(
  source: Record<string, string | undefined> = process.env,
): string[] {
  return Object.entries(source)
    .filter(([, value]) => typeof value === 'string')
    .map(([name]) => name)
    .sort();
}
