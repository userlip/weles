// A copy of a persistent browser profile for a check that must not hold the
// profile itself, so a second Chromium can open the copy beside a window
// that already holds the original. Chromium's lock files and the caches it
// rebuilds on start are left behind; the copy is removed by `cleanup`.

import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// Chromium's own directory names for what it rebuilds on start.
const REBUILT_ON_START = new Set([
  'Crashpad',
  'Crash Reports',
  'Cache',
  'Code Cache',
  'GPUCache',
  'ShaderCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Safe Browsing',
  'optimization_guide_model_store',
  'component_crx_cache',
  'extensions_crx_cache',
]);

function copied(src) {
  const base = basename(src);
  return !base.startsWith('Singleton') && !REBUILT_ON_START.has(base);
}

/**
 * The profile directory a check runs in: a fresh copy of `sourceDir` named
 * after `purpose`, or `sourceDir` itself when `useCopy` is false.
 */
export function profileForCheck(sourceDir, purpose, useCopy) {
  if (!useCopy) return { dir: sourceDir, cleanup: () => {} };
  const parent = mkdtempSync(join(tmpdir(), `weles-${purpose}-profile-`));
  const dir = join(parent, 'profile');
  cpSync(sourceDir, dir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: copied,
  });
  return {
    dir,
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}
