// The page basics: text normalisation, the summary writer, and DOM and text
// dumps beside the run's recordings. A dump or a summary that cannot be
// written fails the run.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { OUTPUT_PATH, OUT_DIR } from './settings.mjs';

const INDENT = '  ';

/** `text` with its runs of whitespace as single spaces, trimmed. */
export function norm(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/** The summary, at OUTPUT_PATH and as the run's artifact. */
export function writeSummary(summary) {
  const text = JSON.stringify(summary, null, INDENT);
  writeFileSync(OUTPUT_PATH, text);
  const runDir = runRecordingsDir('version_history_ui_phrase');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'overleaf_version_history_summary.json'), text);
}

const tags = [];
/** The page's DOM and visible text under `tag`; answers both paths and the text. */
export async function dump(s, tag) {
  tags.push(tag);
  const base = `${OUT_DIR}/${tags.length}_${tag}`;
  const html = await s.page.content();
  const text = await s.page.evaluate(() => document.body.innerText);
  writeFileSync(`${base}.html`, html);
  writeFileSync(`${base}.txt`, text);
  console.log(`[version_history_ui] ${tag} url=${s.page.url()} html=${base}.html text=${base}.txt`);
  return { html: `${base}.html`, text: `${base}.txt`, bodyText: text };
}

