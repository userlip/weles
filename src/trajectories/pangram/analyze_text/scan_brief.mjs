// The scan request: which operator input channel supplied the text and in which
// order the channels win, which dashboard URL the run opens, how the text is
// fingerprinted in the evidence record, and where the artifacts are written.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';

export const LABEL = 'pangram_analyze_text';
export const RESULT_FILE = 'pangram_result.json';

// Pangram's own public address is the page this trajectory drives; a
// deployment that reaches it elsewhere names PANGRAM_ANALYZE_URL, or
// PANGRAM_BASE_URL / PANGRAM_URL for the origin.
const PANGRAM_ORIGIN = 'https://www.pangram.com';

export function dashboardUrl() {
  if (process.env.PANGRAM_ANALYZE_URL) return process.env.PANGRAM_ANALYZE_URL;
  const base = process.env.PANGRAM_BASE_URL || process.env.PANGRAM_URL;
  return `${(base ? base : PANGRAM_ORIGIN).replace(/\/+$/, '')}/`;
}

/**
 * The text to scan: PANGRAM_TEXT (or the runner's SVC_TEXT / TEXT) when it
 * holds more than blanks, else the file PANGRAM_TEXT_FILE (or TEXT_FILE /
 * MESSAGE_FILE) names. A named file that cannot be read is refused with its
 * path and cause, never read as no text; with neither named the text is
 * empty and the caller refuses it, listing the settings.
 */
export function inputText() {
  const direct =
    process.env.PANGRAM_TEXT || process.env.SVC_TEXT || process.env.TEXT;
  if (direct?.trim()) return direct;
  const path =
    process.env.PANGRAM_TEXT_FILE ||
    process.env.TEXT_FILE ||
    process.env.MESSAGE_FILE;
  if (!path) return '';
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(
      `the text file ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function textStats(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return {
    chars: text.length,
    words,
    sha256: createHash('sha256').update(text).digest('hex'),
    preview: text.replace(/\s+/g, ' ').trim(),
  };
}

export function writeJson(name, value) {
  const dir = runRecordingsDir(process.env.ACTION || LABEL);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(value, null, '  '));
}

export function mergeResult(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && v !== undefined && out[k] === undefined) out[k] = v;
  }
  return out;
}
