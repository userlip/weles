// The environment the version-history probe runs with: the project and the
// phrase to find (the caller's; no paper title is built in), the dumps and
// summary beside the run's recordings, and the recording switches this
// trajectory turns off.
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedBudget, statedText } from '../../_shared/inputs/stated.mjs';

const [, , projectArg, ...phraseArgs] = process.argv;
export const target = projectArg
  ? projectArg
  : statedText(
      ['OVERLEAF_PROJECT'],
      'the Overleaf project: its id, or text its dashboard title contains',
    );
export const queryText = phraseArgs.length
  ? phraseArgs.join(' ')
  : statedText(
      ['OVERLEAF_QUERY_TEXT', 'OVERLEAF_PHRASE'],
      'the phrase looked for in the version history',
    );
export const isId = /^[\dA-Fa-f]+$/.test(target);

export const OUT_DIR = runRecordingsDir('version_history_ui_phrase');
export const OUTPUT_PATH = process.env.OVERLEAF_OUTPUT
  ? process.env.OVERLEAF_OUTPUT
  : `${OUT_DIR}/summary.json`;
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
