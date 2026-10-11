/**
 * Recording directory auto-pruning.
 *
 * Walks a directory recursively and removes oldest files (by mtime) until
 * total size drops below the byte budget. Sidecar files that share the same
 * stem as a deleted file are removed alongside their parent.
 */

import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, extname } from 'node:path';

const SIDECAR_EXTS = [
  '.json',
  '.txt',
  '.log',
  '.png',
  '.webm',
  '.har',
  '.html',
];

interface FileEntry {
  mtime: number;
  size: number;
  path: string;
}

// Every regular file under `dir`. A directory or file that cannot be examined
// is added to `failures` with its path and cause: skipped silently, its bytes
// were neither counted nor removable, and a host could fill while pruning
// reported nothing.
function walk(dir: string, failures: string[]): FileEntry[] {
  const result: FileEntry[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    failures.push(`list ${dir}: ${(error as Error).message}`);
    return result;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(full, failures));
      continue;
    }
    try {
      const st = statSync(full);
      result.push({ mtime: st.mtimeMs, size: st.size, path: full });
    } catch (error) {
      failures.push(`examine ${full}: ${(error as Error).message}`);
    }
  }
  return result;
}

/**
 * Remove the oldest files under `dir` until it holds at most `maxBytes`.
 * Returns every operation that failed, with its path and cause; an empty list
 * means every file pruning reached was handled.
 */
export function pruneRecordings(dir: string, maxBytes: number): string[] {
  const failures: string[] = [];
  const files = walk(dir, failures);
  files.sort((a, b) => a.mtime - b.mtime); // oldest first
  let total = files.reduce((s, f) => s + f.size, 0);
  if (total <= maxBytes) return failures;

  for (const { size, path: fp } of files) {
    if (total <= maxBytes) break;
    try {
      unlinkSync(fp);
      total -= size;
    } catch (error) {
      failures.push(`remove ${fp}: ${(error as Error).message}`);
      continue;
    }
    // Remove sidecar files with same stem; one that is not there is not a failure.
    const stem = fp.slice(0, fp.length - extname(fp).length);
    for (const ext of SIDECAR_EXTS) {
      const sc = stem + ext;
      if (sc === fp) continue;
      try {
        const scSize = statSync(sc).size;
        unlinkSync(sc);
        total -= scSize;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          failures.push(`remove ${sc}: ${(error as Error).message}`);
      }
    }
  }
  return failures;
}
