#!/usr/bin/env node
// The disagreements between the three version documents of one committed
// revision, one line each; nothing when they agree.
//
// The version gate judges a tree against `released-surface.json` (the
// surface Stado serves and its version), `release/version-change.json` (that
// release as `current`, the version this tree becomes as `candidate`) and
// `package.json` (the version this tree builds). They agree when the
// baseline's version is the declaration's current and package.json's version
// is its candidate. This reads the three documents of a commit as Git holds
// them, so it judges what was committed, not a working tree, and needs no
// build. A document Git cannot show, or one that holds no version, is
// refused naming the revision and the path.
//
// Usage: node scripts/release/version/disagreements.mjs --revision <commit>

import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { revision: { type: 'string' } } });
if (!values.revision) {
  throw new Error('--revision is required: name the commit whose version documents are compared');
}
const revision = values.revision;

/** The JSON document `path` holds at `revision`, as Git stores it. */
function committed(path) {
  let shown;
  try {
    shown = execFileSync('git', ['show', `${revision}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`git show ${revision}:${path} failed: ${error.stderr || error.message}`);
  }
  return JSON.parse(shown);
}

/** The string `field` of `document`, refused naming `path` when it is not one. */
function text(document, field, path) {
  const value = document[field];
  if (typeof value !== 'string') {
    throw new Error(`${path} at ${revision} names no ${field}`);
  }
  return value;
}

const baseline = text(committed('released-surface.json'), 'version', 'released-surface.json');
const declaration = committed('release/version-change.json');
const current = text(declaration, 'current', 'release/version-change.json');
const candidate = text(declaration, 'candidate', 'release/version-change.json');
const manifest = text(committed('package.json'), 'version', 'package.json');

if (baseline !== current) {
  console.log(`released-surface.json names ${baseline}, release/version-change.json's current is ${current}`);
}
if (manifest !== candidate) {
  console.log(`package.json names ${manifest}, release/version-change.json's candidate is ${candidate}`);
}
