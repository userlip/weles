// The persona a persistent browser profile is bound to. A profile that keeps
// a site's sign-in must present the same fingerprint on every run, so the
// persona is written into the profile the first time it is used and read
// back from there afterwards.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';

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
  writeFileSync(path, JSON.stringify(persona, null, '  '));
  return persona;
}
