#!/usr/bin/env node
// Lists the text files of one committed revision that hold more lines than a
// limit the caller states, for a defect register's revision-bound completion
// probe of files that must be split:
//
//   node tests/sizes.mjs <revision> <line-limit> <path>...
//
// Standard output carries one `revision:path:lines` per file over the limit
// and is empty when none is. A line is a newline character, as wc -l counts
// it; a file holding a NUL byte is binary and is not counted. A revision or
// path git cannot read fails the command with git's reason.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
// argv holds node and this script before the caller's words.
const [, , revision, stated, ...paths] = process.argv;
assert.ok(revision && stated && paths.length, 'usage: node tests/sizes.mjs <revision> <line-limit> <path>...');
const limit = Number(stated);
assert.ok(Number.isSafeInteger(limit), `line-limit must be a whole number, not ${stated}`);

const git = (args) => {
  const answer = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: Infinity });
  assert.ok(answer.status === spawnSync('true').status,
    `git ${args.join(' ')} failed (${answer.status}${answer.error ? `, ${answer.error.message}` : ''}): ${answer.stderr}`);
  return answer.stdout;
};

const files = git(['ls-tree', '-r', '--name-only', revision, '--', ...paths]).split('\n').filter(Boolean);
for (const file of files) {
  const text = git(['show', `${revision}:${file}`]);
  if (text.includes('\0')) continue;
  const lines = [...text].filter((character) => character === '\n').length;
  if (lines > limit) process.stdout.write(`${revision}:${file}:${lines}\n`);
}
