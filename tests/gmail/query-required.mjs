import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceFor } from '../security/evidence.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const home = join(root, 'build/real-tests/gmail-query-home', randomUUID());
const evidence = await evidenceFor('gmail-query-required');
const { report } = evidence;
report.scope = 'gmail_trajectory_query_refusal';

try {
  await mkdir(home, { recursive: true });
  for (const trajectory of [
    'src/trajectories/gmail/gmail_search.mjs',
    'src/trajectories/gmail/gmail_login_search.mjs',
  ]) {
    for (const [input, query] of [
      ['missing', undefined],
      ['whitespace', '   '],
    ]) {
      const env = { HOME: home, PATH: process.env.PATH };
      if (query !== undefined) env.GM_QUERY = query;
      const result = spawnSync(process.execPath, [trajectory], {
        cwd: root,
        env,
        encoding: 'utf8',
      });
      report.operations.push({
        command: [process.execPath, trajectory],
        input,
        exit_status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error?.message,
      });
      assert.equal(result.error, undefined);
      assert.ok(result.status, 'missing query must refuse the run');
      assert.match(result.stderr, /GMAIL_QUERY_REQUIRED:.*GM_QUERY/);
      assert.equal(
        result.stdout,
        '',
        'refusal precedes browser and mailbox output',
      );
    }
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  throw error;
} finally {
  await rm(home, { recursive: true, force: true });
  await evidence.finish();
}
