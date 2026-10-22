// Digests of the code a run executed: every file's relative name and bytes,
// in sorted order, so the digest does not depend on the filesystem's walk.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { WELES_ROOT, captureFailure, captureFailures } from './failures.js';

export type TreeDigest = {
  digest: string;
  file_count: number;
  total_bytes: number;
};

/** The digest of `files`, each named in the digest by `nameOf`. */
function digestFiles(
  files: readonly string[],
  nameOf: (file: string) => string,
): TreeDigest {
  const hash = createHash('sha256');
  const sizes = files.map((file) => {
    const bytes = readFileSync(file);
    hash.update(nameOf(file));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
    return bytes.byteLength;
  });
  return {
    digest: hash.digest('hex'),
    file_count: files.length,
    // Number() is the additive identity, so an empty tree totals nothing.
    total_bytes: sizes.reduce((sum, size) => sum + size, Number()),
  };
}

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile()) files.push(path);
  }
}

/**
 * Every file under `root`. A tree that cannot be read is recorded against
 * `field` and leaves the digest absent.
 */
export function hashTree(root: string, field: string): TreeDigest | undefined {
  let digest: TreeDigest | undefined;
  try {
    const files: string[] = [];
    walk(root, files);
    files.sort();
    digest = digestFiles(files, (file) => relative(root, file));
  } catch (error) {
    captureFailures.push(captureFailure(field, `hash tree ${root}`, error));
  }
  return digest;
}

/**
 * The worker launchers: every .mjs directly under src/worker, the process
 * entry the worker starts with, which neither dist/ nor src/trajectories/
 * covers.
 */
export function hashWorkerEntry(): TreeDigest | undefined {
  const field = 'runner_entry_sha256';
  const dir = join(WELES_ROOT, 'src', 'worker');
  let digest: TreeDigest | undefined;
  try {
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
      .map((entry) => entry.name)
      .sort();
    if (!names.length)
      throw new Error(`no worker launcher .mjs file is present in ${dir}`);
    digest = digestFiles(
      names.map((name) => join(dir, name)),
      (file) => relative(dir, file),
    );
  } catch (error) {
    captureFailures.push(captureFailure(field, `hash launchers ${dir}`, error));
  }
  return digest;
}
