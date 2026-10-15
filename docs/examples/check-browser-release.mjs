#!/usr/bin/env node
// Show the fail-closed browser selection from dist/session/find_browser.js.
// findCustomBrowser returns a path ONLY when a release is selected (the
// deployment's WELES_CHROMIUM_RELEASE_VERSION/SHA256 pin, else the host's
// <install root>/selected record the Stado delivery writes) AND the installed
// binary carries a verification receipt matching the immutable Stado
// coordinate + checksum. Anything less returns undefined, and
// customBrowserSearchHint says why.
//
// Usage: node docs/examples/check-browser-release.mjs
// Runs offline against an install root of its own under build/; the
// synthetic release is never downloaded.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { findCustomBrowser, customBrowserSearchHint } = await import(`${repo}/dist/session/find_browser.js`);
const root = join(repo, 'build', 'docs-example-browser-release');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
process.env.WELES_CHROMIUM_DIR = root;
delete process.env.WELES_CHROMIUM_RELEASE_VERSION;
delete process.env.WELES_CHROMIUM_RELEASE_SHA256;

console.log('1) nothing selected (no pin, no selection record):');
console.log("   findCustomBrowser('chromium') ->", findCustomBrowser('chromium'));
console.log('   hint:', customBrowserSearchHint('chromium'));

console.log('\n2) a selection record for a release that was never installed:');
writeFileSync(join(root, 'selected'), `version=0.0.0-docs-example\nsha256=${'a'.repeat(64)}\n`);
console.log("   findCustomBrowser('chromium') ->", findCustomBrowser('chromium'));
console.log('   hint:', customBrowserSearchHint('chromium'));

console.log('\n3) a deployment that pins only the version:');
process.env.WELES_CHROMIUM_RELEASE_VERSION = '0.0.0-docs-example';
console.log('   hint:', customBrowserSearchHint('chromium'));

console.log('\n4) unknown browser family:');
console.log('   hint:', customBrowserSearchHint('netscape'));
rmSync(root, { recursive: true, force: true });
