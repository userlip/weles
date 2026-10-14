import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { parseArgs } from 'node:util';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('overleaf-push-github');
const { report, request } = evidence;
const { values } = parseArgs({
  options: {
    'project-id': { type: 'string' },
    'repo-slug': { type: 'string' },
    'commit-message': { type: 'string' },
  },
});
const project = values['project-id'];
const repoSlug = values['repo-slug'];
const message = values['commit-message'];
let connected = false;
let failure;

async function github(path) {
  const response = await fetch(new URL(path, 'https://api.github.com'), {
    headers: { Accept: 'application/vnd.github+json' },
  });
  const body = await response.text();
  assert.ok(response.ok, `GitHub ${path} HTTP ${response.status}: ${body}`);
  return JSON.parse(body);
}

async function run(params) {
  const admission = await request('/run', {
    action: 'overleaf_push_github',
    params,
    detached: true,
  });
  const id = admission.value.detached_run;
  assert.ok(id, JSON.stringify(admission.value));
  evidence.runs.add(id);
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

try {
  assert.equal(
    hostname(),
    process.env.WELES_TEST_DEDICATED_HOST,
    'run on the Stado-selected dedicated Weles host',
  );
  for (const [name, value] of Object.entries({ project, repoSlug, message })) {
    assert.ok(typeof value === 'string' && value.trim(), `${name} is required`);
  }
  const [owner, repository, ...extra] = repoSlug.split('/');
  assert.ok(
    owner && repository && !extra.length,
    'repo-slug must be owner/name',
  );
  const repoPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  report.fixture = { project, repo: repoSlug };
  await evidence.connect();
  connected = true;
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);
  const repo = await github(repoPath);
  const branchPath = `${repoPath}/commits/${encodeURIComponent(repo.default_branch)}`;
  const before = await github(branchPath);
  assert.notEqual(
    before.commit.message,
    message,
    'fixture already has this message',
  );
  report.before = { sha: before.sha, message: before.commit.message };

  const absent = await run({
    project,
    repo_slug: repoSlug,
    commit_message: '',
  });
  assert.equal(absent.ok, false, JSON.stringify(absent));
  assert.match(
    [absent.error, absent.stderr_tail, absent.stdout_tail].join('\n'),
    /none of OVERLEAF_COMMIT_MESSAGE is set/,
  );
  report.missing_message = absent;

  const pushed = await run({
    project,
    repo_slug: repoSlug,
    commit_message: message,
  });
  assert.equal(pushed.ok, true, JSON.stringify(pushed));
  const after = await github(branchPath);
  assert.notEqual(after.sha, before.sha, 'GitHub received no new commit');
  assert.equal(
    after.commit.message,
    message,
    'GitHub recorded a different message',
  );
  report.after = { sha: after.sha, message: after.commit.message };
  report.terminal = pushed;
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = connected ? 'failed' : 'blocked';
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
} finally {
  await evidence.finish();
}
if (failure) throw failure;
