import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { activeSkarbiecBinary } from '../../src/_shared/skarbiec-runtime.mjs';
import { evidenceFor } from '../security/evidence.mjs';

const evidence = await evidenceFor('account-persistence');
const { report } = evidence;
const root = fileURLToPath(new URL('../../', import.meta.url));
let failure;
let admitted = false;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for the isolated provider journey`);
  return value;
}

function fixture(name) {
  const path = realpathSync(required(name));
  const allowed = `${realpathSync(join(root, 'build/real-tests'))}${sep}`;
  if (!path.startsWith(allowed))
    throw new Error(
      `${name} must be an isolated vault under build/real-tests/`,
    );
  return path;
}

function command(program, args, vault, secretOutput = false) {
  const result = spawnSync(program, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, SKARBIEC_VAULT_FILE: vault },
  });
  report.operations.push({
    command: [program, ...args],
    vault,
    exit_status: result.status,
    signal: result.signal,
    stdout: secretOutput ? '[vault document omitted]' : result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.ok(Number.isInteger(result.status), JSON.stringify(result));
  return result;
}

function accounts(skarbiec, vault, platform) {
  const listed = command(skarbiec, ['list'], vault, true);
  assert.ok(!listed.status, listed.stderr);
  return JSON.parse(listed.stdout)
    .filter(
      (row) =>
        Array.isArray(row.tags) &&
        row.tags.includes('weles:record:trajectory-account') &&
        !row.deleted,
    )
    .map((row) => {
      const id = row.id ?? row.name;
      assert.ok(id, 'tagged Skarbiec account inventory row has no id or name');
      const result = command(skarbiec, ['get', String(id)], vault, true);
      assert.ok(!result.status, result.stderr);
      const document = JSON.parse(result.stdout);
      const rawMetadata = document.fields?.metadata_json;
      assert.equal(
        typeof rawMetadata,
        'string',
        `account ${id} has no metadata_json`,
      );
      return {
        id: String(id),
        username: document.fields?.username,
        password: document.fields?.password,
        metadata: JSON.parse(rawMetadata),
        platform: document.context?.platform,
      };
    })
    .filter((account) => account.platform === platform);
}

function onlyAccount(skarbiec, vault, platform) {
  const [account, ...additional] = accounts(skarbiec, vault, platform);
  assert.ok(
    account && !additional.length,
    `fixture needs exactly one ${platform} account`,
  );
  return account;
}

try {
  assert.equal(hostname(), required('WELES_TEST_DEDICATED_HOST'));
  required('PROXY_URL');
  const refusalVault = fixture('WELES_TEST_REFUSAL_VAULT');
  const successVault = fixture('WELES_TEST_SUCCESS_VAULT');
  assert.notEqual(refusalVault, successVault);
  const expectedHandle = required('WELES_TEST_PRODUCTHUNT_HANDLE');
  const skarbiec = activeSkarbiecBinary();
  report.skarbiec_binary_sha256 = createHash('sha256')
    .update(readFileSync(skarbiec))
    .digest('hex');
  report.fixtures = {
    refusal_vault: refusalVault,
    success_vault: successVault,
  };
  admitted = true;

  for (const [source, destination, entry] of [
    ['twitter', 'producthunt', 'src/trajectories/producthunt/register.mjs'],
    ['instagram', 'threads', 'src/trajectories/meta/threads_register.mjs'],
  ]) {
    const account = onlyAccount(skarbiec, refusalVault, source);
    assert.ok(
      !account.metadata.email || !account.password,
      `${source} refusal fixture must lack email or password`,
    );
    assert.deepEqual(accounts(skarbiec, refusalVault, destination), []);
    const result = command(process.execPath, [entry], refusalVault);
    assert.ok(
      result.status,
      `${destination} must refuse incomplete source identity`,
    );
    assert.ok(
      result.stdout.includes(`${source}_account_incomplete`),
      result.stdout,
    );
    assert.deepEqual(accounts(skarbiec, refusalVault, destination), []);
  }

  const twitter = onlyAccount(skarbiec, successVault, 'twitter');
  const instagram = onlyAccount(skarbiec, successVault, 'instagram');
  for (const account of [twitter, instagram]) {
    assert.ok(
      account.metadata.email && account.password,
      `${account.platform} fixture must have real email and password`,
    );
    assert.ok(
      Array.isArray(account.metadata.cookies) &&
        account.metadata.cookies.length,
      `${account.platform} fixture must have a real authenticated session`,
    );
  }
  assert.deepEqual(accounts(skarbiec, successVault, 'producthunt'), []);
  assert.deepEqual(accounts(skarbiec, successVault, 'threads'), []);
  for (const entry of [
    'src/trajectories/producthunt/register.mjs',
    'src/trajectories/meta/threads_register.mjs',
  ]) {
    const result = command(process.execPath, [entry], successVault);
    assert.ok(!result.status, `${entry}: ${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.includes('PASS:'), result.stdout);
  }
  const productHunt = onlyAccount(skarbiec, successVault, 'producthunt');
  const threads = onlyAccount(skarbiec, successVault, 'threads');
  assert.equal(productHunt.username, expectedHandle);
  assert.equal(productHunt.metadata.email, twitter.metadata.email);
  assert.equal(productHunt.password, twitter.password);
  assert.equal(productHunt.metadata.linked_twitter_username, twitter.username);
  assert.equal(threads.username, instagram.username);
  assert.equal(threads.metadata.email, instagram.metadata.email);
  assert.equal(threads.password, instagram.password);
  for (const account of [productHunt, threads]) {
    if (account.metadata.session_unreadable) {
      assert.equal(account.metadata.cookies, undefined);
      assert.equal(account.metadata.cookies_minted_at, undefined);
    } else {
      assert.ok(Array.isArray(account.metadata.cookies));
    }
  }
  report.saved = {
    producthunt: { id: productHunt.id, username: productHunt.username },
    threads: { id: threads.id, username: threads.username },
  };
  report.status = 'passed';
} catch (error) {
  failure = error;
  report.status = admitted ? 'failed' : 'blocked';
  report.error = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
} finally {
  await evidence.finish();
}
if (failure) throw failure;
