// The client compatibility window /api/v1/version reports, as the deployment
// states it: the environment the service declaration hands this process
// carries the same three variables weles-web answers its version route from.
// An undeclared value is reported as null, never written here as a guess of
// which client versions this worker serves.

function declaredText(environment, name) {
  const value = environment[name]?.trim();
  if (!value) return null;
  return value;
}

export function declaredClientWindow(environment) {
  const generations = declaredText(
    environment,
    'WELES_CLIENT_SUPPORTED_GENERATIONS',
  );
  if (generations !== null && !Number.isSafeInteger(Number(generations))) {
    throw new Error(
      `WELES_CLIENT_SUPPORTED_GENERATIONS must be an integer, got ${JSON.stringify(generations)}`,
    );
  }
  return Object.freeze({
    currentVersion: declaredText(environment, 'WELES_CLIENT_CURRENT_VERSION'),
    minimumVersion: declaredText(environment, 'WELES_CLIENT_MINIMUM_VERSION'),
    supportedGenerations: generations === null ? null : Number(generations),
  });
}
