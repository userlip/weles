import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('github-publishing');
const { report, request } = evidence;
report.scope = 'isolated_github_publishing';
let connected = false;
let failure;

async function run(action, params) {
  const admitted = await request('/run', { action, params, detached: true });
  const id = admitted.value.detached_run;
  assert.ok(id, JSON.stringify(admitted.value));
  evidence.runs.add(id);
  const terminal = await request(
    `/diagnostics/${encodeURIComponent(id)}/file?path=run-result.json&wait=terminal`,
  );
  assert.ok(terminal.value, `terminal result unavailable for ${id}`);
  return terminal.value;
}

async function github(path) {
  const endpoint = new URL(path, 'https://api.github.com');
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'weles-real-tests',
    },
  });
  const body = await response.text();
  report.provider_reads.push({
    endpoint: endpoint.href,
    status: response.status,
    body,
  });
  assert.equal(response.ok, true, `${endpoint.href}: ${response.status} ${body}`);
  return JSON.parse(body);
}

try {
  const { values } = parseArgs({
    options: {
      owner: { type: 'string' },
      'repo-prefix': { type: 'string' },
      'repo-description': { type: 'string' },
      'existing-repo': { type: 'string' },
      branch: { type: 'string' },
      'file-path': { type: 'string' },
      'append-prefix': { type: 'string' },
      'commit-message': { type: 'string' },
    },
  });
  for (const key of [
    'owner',
    'repo-prefix',
    'repo-description',
    'existing-repo',
    'branch',
    'file-path',
    'append-prefix',
    'commit-message',
  ]) {
    assert.ok(
      values[key]?.trim(),
      `--${key} is required for the isolated fixture`,
    );
  }
  const createdName = `${values['repo-prefix']}-${randomUUID()}`;
  const append = `\n${values['append-prefix']}-${randomUUID()}`;
  report.fixture = {
    owner: values.owner,
    created_name: createdName,
    description: values['repo-description'],
    existing_repo: values['existing-repo'],
    branch: values.branch,
    file_path: values['file-path'],
    append,
    commit_message: values['commit-message'],
  };
  report.provider_reads = [];

  await evidence.connect();
  const health = await request('/healthz');
  assert.equal(health.value.sourceRevision, report.source_revision);
  connected = true;

  for (const [action, params, cause] of [
    ['github_create_repo', {}, 'none of REPO_NAME is set'],
    ['github_create_repo', { repo_name: createdName }, 'none of REPO_DESC is set'],
    [
      'github_create_repo',
      { repo_name: 'not a name', repo_desc: values['repo-description'] },
      'holds characters GitHub does not take',
    ],
    ['github_commit', {}, 'none of REPO_URL is set'],
    [
      'github_commit',
      { repo_url: `${values.owner}/${values['existing-repo']}` },
      'none of COMMIT_BRANCH is set',
    ],
    [
      'github_commit',
      {
        repo_url: `${values.owner}/${values['existing-repo']}`,
        commit_branch: values.branch,
      },
      'none of FILE_PATH is set',
    ],
    [
      'github_commit',
      {
        repo_url: `${values.owner}/${values['existing-repo']}`,
        commit_branch: values.branch,
        file_path: values['file-path'],
      },
      'none of COMMIT_MESSAGE is set',
    ],
    [
      'github_commit',
      {
        repo_url: `${values.owner}/${values['existing-repo']}`,
        commit_branch: values.branch,
        file_path: values['file-path'],
        commit_message: values['commit-message'],
      },
      'FILE_APPEND is not set',
    ],
    [
      'github_commit',
      {
        repo_url: 'https://example.invalid/owner/repo',
        commit_branch: values.branch,
        file_path: values['file-path'],
        commit_message: values['commit-message'],
        file_append: append,
      },
      'REPO_URL must name a GitHub repository',
    ],
  ]) {
    const refused = await run(action, params);
    assert.equal(refused.status, 'failed');
    assert.equal(refused.ok, false);
    assert.ok(
      [refused.error, refused.stderr_tail, refused.stdout_tail]
        .join('\n')
        .includes(cause),
      JSON.stringify(refused),
    );
  }

  const created = await run('github_create_repo', {
    repo_name: createdName,
    repo_desc: values['repo-description'],
  });
  assert.equal(created.status, 'finished', JSON.stringify(created));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.ok(
    created.stdout_tail.includes(`PASS: created ${values.owner}/${createdName}`),
  );
  report.created = created;
  const repo = await github(
    `/repos/${encodeURIComponent(values.owner)}/${encodeURIComponent(createdName)}`,
  );
  assert.equal(repo.name, createdName);
  assert.equal(repo.description, values['repo-description']);
  report.created_repo = {
    name: repo.name,
    description: repo.description,
    url: repo.html_url,
  };

  const existing = `${values.owner}/${values['existing-repo']}`;
  const committed = await run('github_commit', {
    repo_url: existing,
    commit_branch: values.branch,
    file_path: values['file-path'],
    file_append: append,
    commit_message: values['commit-message'],
  });
  assert.equal(committed.status, 'finished', JSON.stringify(committed));
  assert.equal(committed.ok, true, JSON.stringify(committed));
  assert.ok(
    committed.stdout_tail.includes(
      `PASS: committed to https://github.com/${existing}/${values['file-path']} on ${values.branch}`,
    ),
  );
  const file = await github(
    `/repos/${existing}/contents/${values['file-path']}?ref=${encodeURIComponent(values.branch)}`,
  );
  assert.ok(
    Buffer.from(file.content, 'base64').toString('utf8').endsWith(append),
  );
  const commits = await github(
    `/repos/${existing}/commits?sha=${encodeURIComponent(values.branch)}&path=${encodeURIComponent(values['file-path'])}`,
  );
  const latest = commits.shift();
  assert.equal(latest?.commit?.message, values['commit-message']);
  report.observed_commit = {
    sha: latest?.sha,
    message: latest?.commit?.message,
  };
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = connected ? 'failed' : 'blocked';
  report.error = { name: error.name, message: error.message, stack: error.stack };
} finally {
  await evidence.finish();
}
if (failure) throw failure;
