// A persistent browser profile that keeps a site's sign-in, and the persona it
// is bound to. The profile is the directory the run states (WELES_USER_DATA_DIR,
// or ADS_PROFILE_DIR for the ads consoles), else the service's own kept
// profile under ~/.weles/browser_profiles/<service>. It must present the same
// fingerprint on every run, so the persona is written into the profile the
// first time it is used and read back from there afterwards.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';

const INDENT = '  ';
const STATED_PROFILE = ['WELES_USER_DATA_DIR', 'ADS_PROFILE_DIR'];

/** Where the kept browser profile at `segments` (a service, or a service and an account) lives, created or not. */
export function keptProfilePath(...segments) {
  return join(homedir(), '.weles', 'browser_profiles', ...segments);
}

/** The kept browser profile directory of `service` (created when absent). */
export function keptProfileDir(service) {
  const stated = STATED_PROFILE.find((name) => process.env[name]);
  const dir = stated ? process.env[stated] : keptProfilePath(service);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * The persona stored as persona.json in `userDataDir`; when the profile has
 * none yet, a fresh macOS Chromium persona is generated and stored there.
 * A stored persona that is not JSON is refused by the parser with its own
 * error rather than replaced, since a new fingerprint would cost the profile
 * its sign-in.
 */
export function stableProfilePersona(userDataDir) {
  const path = join(userDataDir, 'persona.json');
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const persona = generatePersona({ os: 'macos', browser: 'chromium' });
  writeFileSync(path, JSON.stringify(persona, null, INDENT));
  return persona;
}
