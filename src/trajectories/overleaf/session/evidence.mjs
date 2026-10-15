// What an Overleaf trajectory leaves behind: a DOM dump per named step beside
// the run's recordings, and a step failure that names its dump. A DOM dump,
// not a screenshot: a screenshot waits for fonts and stability the Overleaf
// editor never reaches (continuous PDF compile, CodeMirror, websockets), while
// page.content() serializes the current DOM at once and is the better record
// for locating a missed selector.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

/** The evidence of the run labelled `label`: `shot(s, tag)` dumps the DOM, `fail(s, tag, message)` throws naming that dump. */
export function overleafEvidence(label) {
  const dir = runRecordingsDir(label);
  mkdirSync(dir, { recursive: true });
  const tags = [];
  const shot = async (s, tag) => {
    tags.push(tag);
    const path = join(dir, `${tags.length}_${tag}.html`);
    const html = await s.page.content();
    writeFileSync(path, html);
    console.log(`[${label}] [${tag}] DOM ${path} (${html.length}b)`);
    return path;
  };
  const fail = async (s, tag, message) => {
    const path = await shot(s, `fail_${tag}`);
    throw new Error(`OVERLEAF_STEP_FAILED: ${tag} — ${message}; the page's DOM is kept in ${path}`);
  };
  return { shot, fail };
}
