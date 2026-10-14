// The environment the version-history probe runs with: the project and the phrase to find,
// the DOM dumps and summary beside the run's recordings, the recording switches this
// trajectory turns off, and the persistent Overleaf browser profile.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedBudget, statedText } from '../../_shared/inputs/stated.mjs';

// The project is the caller's; no paper title is built in.
export const target = process.argv[2] || process.env.OVERLEAF_PROJECT || '';
if (!target) {
  console.error(
    'FAIL: need the Overleaf project as argv[2] or OVERLEAF_PROJECT (24-hex id or title substring)',
  );
  process.exit(1);
}
export const queryText =
  process.argv.slice(3).join(' ') ||
  process.env.OVERLEAF_QUERY_TEXT ||
  process.env.OVERLEAF_PHRASE ||
  '';
export const isId = /^[0-9a-fA-F]{24}$/.test(target);

export const OUT_DIR = runRecordingsDir('version_history_ui_phrase');
export const OUTPUT_PATH =
  process.env.OVERLEAF_OUTPUT || `${OUT_DIR}/summary.json`;
// Which file the phrase is searched in, and how many history entries are
// opened, are the caller's to state.
export const MAIN_TEX = statedText(
  ['OVERLEAF_MAIN_TEX'],
  'the project file the phrase is searched in (e.g. main.tex)',
);
export const MAX_HISTORY_CLICKS = statedBudget(
  'OVERLEAF_HISTORY_MAX_CLICKS',
  'how many version-history entries the probe opens',
);

process.env.WELES_DISABLE_RECORDING = '1';
process.env.WELES_NO_RESPONSE_BODIES = '1';
process.env.WELES_CHROMIUM_NETLOG = '0';
process.env.WELES_FULL_DIAGNOSTICS = '0';
process.env.WELES_NO_INSTRUMENT = '1';
process.env.WELES_PAGE_DIAGNOSTICS = '0';

// The persistent Overleaf browser profile lives in Weles' own state, beside
// the other reused profiles, never inside the checkout.
export const PROFILE_DIR = join(
  homedir(),
  '.weles',
  'browser_profiles',
  'overleaf',
);
if (
  process.env.WELES_OVERLEAF_PERSISTENT_PROFILE !== '0' &&
  !process.env.WELES_USER_DATA_DIR
) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  process.env.WELES_USER_DATA_DIR = PROFILE_DIR;
}
