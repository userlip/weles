// Where a phrase stands in an Overleaf project's version history, read
// through the History UI only: Overleaf opened signed in with the session
// kept under OVERLEAF_AUTH_LABEL, the project opened, the version history
// shown, and the phrase probed in the current file and in each history entry
// the panel lists (as many as OVERLEAF_HISTORY_MAX_CLICKS allows). The summary
// is written to OVERLEAF_OUTPUT (or the run's recordings).
//
// Usage: node src/trajectories/overleaf/version_history_ui_phrase.mjs <project-id-or-title> <phrase>
import { MAIN_TEX, MAX_HISTORY_CLICKS, OUTPUT_PATH, queryText, target } from './version_history_ui_phrase/settings.mjs';
import { dump, norm, writeSummary } from './version_history_ui_phrase/page.mjs';
import { openHistoryUi, resolveAndOpenProject } from './version_history_ui_phrase/navigate.mjs';
import { summarizeVisible } from './version_history_ui_phrase/summarize.mjs';
import { clickVisibleText, probeHistoryState } from './version_history_ui_phrase/probe.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { pageShows } from '../_shared/page/judged/seen.mjs';

const INDENT = '  ';
const AUTH_LABEL = statedText(['OVERLEAF_AUTH_LABEL'], 'the session store label the Overleaf session is kept under');

// The session modules read the recording switches at import time; the
// settings module above has set them, so the opener loads here.
const [{ openOverleaf }, { exitStatusFor }] = await Promise.all([
  import('../_shared/services/overleaf_google_sign_in.mjs'),
  import('../../../dist/cli/usage.js'),
]);
const { s } = await openOverleaf({ label: 'version_history_ui_phrase', authLabel: AUTH_LABEL, chooseAnotherAccount: true });
try {
  await dump(s, 'dashboard');
  const projectId = await resolveAndOpenProject(s);
  await dump(s, `editor_${projectId}`);
  if (await pageShows(s.page, 'Does the page say access to this project is restricted, or that there is no permission to load it?'))
    throw new Error(`OVERLEAF_PROJECT_RESTRICTED: project ${projectId} opened as restricted at ${s.page.url()}`);
  const method = await openHistoryUi(s);
  await dump(s, `history_open_${method}`);

  const summary = await summarizeVisible(s.page, queryText);
  const clicks = [];
  const probes = [await probeHistoryState(s, 'probe_initial_history', queryText)];
  clicks.push(await clickVisibleText(s.page, MAIN_TEX, 'click_current_main_tex', true));
  probes.push(await probeHistoryState(s, 'probe_current_main_tex', queryText, true));
  const entries = [...new Set(summary.visibleItems)]
    .map(norm)
    .filter((entry) => entry && entry !== MAIN_TEX)
    .filter((entry, index) => index < MAX_HISTORY_CLICKS);
  for (const [index, entry] of entries.entries()) {
    const label = `history_${index}`;
    clicks.push(await clickVisibleText(s.page, entry, `click_${label}`));
    probes.push(await probeHistoryState(s, `probe_${label}`, queryText));
    clicks.push(await clickVisibleText(s.page, MAIN_TEX, `click_${label}_main_tex`, true));
    probes.push(await probeHistoryState(s, `probe_${label}_main_tex`, queryText, true));
  }
  writeSummary({ target, projectId, queryText: norm(queryText), phrase: norm(queryText), mainTex: MAIN_TEX, method, clicks, probes, summary });
  console.log(JSON.stringify({ projectId, method, summaryPath: OUTPUT_PATH, summary }, null, INDENT));
  console.log(`PASS: ${probes.length} probe(s) of project ${projectId}; summary ${OUTPUT_PATH}`);
} catch (error) {
  let failure = error;
  try {
    await dump(s, 'failure');
  } catch (dumpError) {
    failure = new AggregateError([error, dumpError], `${error.message}; and the failure dump was not kept: ${dumpError.message}`);
  }
  console.error(`FAIL: ${failure.message}`);
  process.exitCode = exitStatusFor(failure);
} finally {
  await s.close();
}
