// Weles keeps what a failed network call actually met, not only Node's
// "fetch failed". Real executions over the machine's own network stack:
// - a Kimi sign-in (beginOAuth) run with Node's --use-env-proxy pointed at a
//   proxy host that cannot resolve (RFC 6761 reserves .invalid) and at a
//   loopback port nothing listens on: refused oauth_transport_failed in stage
//   oauth_exchange, naming the endpoint, with the getaddrinfo or connect
//   failure (hostname, address, port) in its cause chain;
// - the credential admission authority behind a real HTTP server, asking a
//   Skarbiec origin that cannot resolve: Service Unavailable with
//   WELES_CREDENTIAL_AUTH_UNAVAILABLE naming that origin, the getaddrinfo
//   failure in its cause chain; two Authorization lines are refused
//   Unauthorized without asking Skarbiec.
// Required: a Node that takes --use-env-proxy; one that does not refuses the
// option before running anything, and the journey stops on that refusal.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { constants as http } from 'node:http2';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = (path) => fileURLToPath(new URL(`../../src/${path}`, import.meta.url));
const OAUTH = source('trajectories/_shared/subscription-auth/oauth.mjs');
const AUTHORITY = source('worker/weles-api-server/credentials/authority.mjs');
const CHAIN = source('_shared/error-chain/index.cjs');
const SIGN_IN_CHILD = 'WELES_TRANSPORT_CAUSES_SIGN_IN';
const PROXY_OPTION = '--use-env-proxy';
const { causeChain, describeError } = await import(CHAIN);

// The sign-in leg runs in its own process, started with PROXY_OPTION, since
// Node reads its proxy settings only when it starts.
if (process.env[SIGN_IN_CHILD]) {
  const { beginOAuth } = await import(OAUTH);
  let answer;
  try {
    answer = { answered: await beginOAuth('kimi') };
  } catch (error) {
    answer = {
      code: error.code, stage: error.stage, status: error.status,
      endpoint: error.endpoint, causes: causeChain(error),
    };
  }
  process.stdout.write(JSON.stringify(answer));
} else {
  await qualify();
}

// This machine's own loopback address, as its interfaces report it.
function loopback() {
  const entry = Object.values(networkInterfaces())
    .flat()
    .find((candidate) => candidate.internal && candidate.family === 'IPv4');
  assert.ok(entry, 'this machine reports no internal IPv4 interface');
  return entry.address;
}

// Without a port, listen asks the operating system for one nothing holds; a
// bind the system refuses is the error this answers.
function listening(server, host) {
  return new Promise((ready, failed) => {
    server.once('error', failed);
    server.listen({ host }, () => {
      server.off('error', failed);
      ready(server.address().port);
    });
  });
}

function closed(server) {
  return new Promise((done, failed) => {
    server.close((error) => (error ? failed(error) : done()));
  });
}

async function closedPort(host) {
  const server = createServer();
  const port = await listening(server, host);
  await closed(server);
  return port;
}

function has(causes, expected) {
  return causes.some((level) =>
    Object.entries(expected).every(([name, value]) => level.fields[name] === value));
}

function ran(run) {
  return !run.error && run.signal === null && !run.status;
}

function signIn(report, proxy) {
  const run = spawnSync(process.execPath, [PROXY_OPTION, fileURLToPath(import.meta.url)], {
    env: { ...process.env, [SIGN_IN_CHILD]: 'yes', HTTPS_PROXY: proxy, NO_PROXY: '' },
    encoding: 'utf8',
  });
  report.commands.push({ argv: [process.execPath, PROXY_OPTION], proxy,
    status: run.status, signal: run.signal, stderr: run.stderr });
  assert.ok(ran(run), `the sign-in process failed: ${run.error} ${run.signal} ${run.stderr}`);
  return JSON.parse(run.stdout);
}

function sent(origin, headers) {
  return new Promise((answered, failed) => {
    const call = httpRequest(origin, { headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('error', failed);
      response.on('end', () => answered({ status: response.statusCode, body: JSON.parse(body) }));
    });
    call.on('error', failed);
    call.end();
  });
}

async function qualify() {
  const { evidenceFor } = await import('../security/evidence.mjs');
  const evidence = await evidenceFor('transport-causes');
  const { report } = evidence;
  report.commands = [];
  const area = join(
    fileURLToPath(new URL('../../build/real-tests/', import.meta.url)),
    'transport-causes-home',
    randomUUID(),
  );
  let server;
  const failures = [];
  try {
    const preflight = spawnSync(process.execPath, [PROXY_OPTION, '--version'], { encoding: 'utf8' });
    report.commands.push({ argv: [process.execPath, PROXY_OPTION, '--version'],
      status: preflight.status, stderr: preflight.stderr });
    assert.ok(ran(preflight), `this Node does not take ${PROXY_OPTION}: ${preflight.stderr}`);
    report.executed_modules = [];
    for (const path of [OAUTH, AUTHORITY, CHAIN])
      report.executed_modules.push({
        path,
        sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
      });
    const kimi = 'https://auth.kimi.com/api/oauth/device_authorization';
    const host = loopback();

    const port = await closedPort(host);
    const unresolvable = `${randomUUID()}.invalid`;
    const missing = signIn(report, `http://${unresolvable}:${port}`);
    report.sign_in_unresolvable_proxy = missing;
    assert.equal(missing.code, 'oauth_transport_failed');
    assert.equal(missing.stage, 'oauth_exchange');
    assert.equal(missing.endpoint, kimi);
    assert.ok(has(missing.causes, { code: 'ENOTFOUND', hostname: unresolvable }),
      JSON.stringify(missing.causes));

    const refused = signIn(report, `http://${host}:${port}`);
    report.sign_in_closed_proxy = refused;
    assert.equal(refused.code, 'oauth_transport_failed');
    assert.equal(refused.stage, 'oauth_exchange');
    assert.equal(refused.endpoint, kimi);
    assert.ok(has(refused.causes, { code: 'ECONNREFUSED', address: host, port }),
      JSON.stringify(refused.causes));

    // A real fetch failure whose non-system levels carry extra enumerable
    // text (a response body, a credential): only the message of such a level
    // and the system error's own fields are named, never that text.
    const leaked = `secret-${randomUUID()}`;
    const fetched = await fetch(`https://${randomUUID()}.invalid/`).then(
      () => assert.fail('a host under .invalid answered'),
      (error) => error,
    );
    fetched.responseBody = leaked;
    const wrapped = new Error('the credential call failed', { cause: fetched });
    wrapped.authorization = `Bearer ${leaked}`;
    const described = describeError(wrapped);
    const levels = causeChain(wrapped);
    report.extra_fields = { described, levels };
    assert.ok(!described.includes(leaked), described);
    assert.ok(!JSON.stringify(levels).includes(leaked), JSON.stringify(levels));
    assert.ok(has(levels, { code: 'ENOTFOUND' }), JSON.stringify(levels));

    await mkdir(area, { recursive: true });
    const tokenFile = join(area, 'admission-token');
    await writeFile(tokenFile, randomUUID(), { mode: constants.S_IRUSR | constants.S_IWUSR });
    const skarbiec = new URL(`https://${randomUUID()}.invalid`);
    const { createCredentialAuthority } = await import(AUTHORITY);
    const authorize = createCredentialAuthority({
      checkedTokenFile: () => tokenFile,
      skarbiecEndpoint: () => skarbiec.origin,
    });
    server = createServer(async (request, response) => {
      response.setHeader('content-type', 'application/json');
      try {
        const consumer = await authorize(request);
        response.writeHead(http.HTTP_STATUS_OK);
        response.end(JSON.stringify({ consumer }));
      } catch (error) {
        response.writeHead(error.status);
        response.end(JSON.stringify({ code: error.code, message: error.message,
          causes: causeChain(error) }));
      }
    });
    const origin = `http://${host}:${await listening(server, host)}`;

    const unavailable = await sent(origin, { Authorization: `Bearer ${randomUUID()}` });
    report.admission_unresolvable_skarbiec = unavailable;
    assert.equal(unavailable.status, http.HTTP_STATUS_SERVICE_UNAVAILABLE);
    assert.equal(unavailable.body.code, 'WELES_CREDENTIAL_AUTH_UNAVAILABLE');
    assert.ok(unavailable.body.message.includes(skarbiec.origin), unavailable.body.message);
    assert.ok(has(unavailable.body.causes, { code: 'ENOTFOUND', hostname: skarbiec.hostname }),
      JSON.stringify(unavailable.body.causes));

    const twice = await sent(origin, [
      'Authorization',
      `Bearer ${randomUUID()}`,
      'Authorization',
      `Bearer ${randomUUID()}`,
    ]);
    report.admission_two_bearers = twice;
    assert.equal(twice.status, http.HTTP_STATUS_UNAUTHORIZED);
    assert.equal(twice.body.code, 'WELES_CREDENTIAL_UNAUTHORIZED');
  } catch (error) {
    failures.push(error);
  }
  for (const [what, cleanup] of [
    ['closing the admission server', () => server && closed(server)],
    ['removing the fixture home', () => rm(area, { recursive: true, force: true })],
  ]) {
    try {
      await cleanup();
    } catch (error) {
      failures.push(new Error(what, { cause: error }));
    }
  }
  report.status = failures.length ? 'failed' : 'passed';
  report.failures = failures.map((failure) => failure.stack);
  try {
    await evidence.finish();
  } catch (error) {
    failures.push(new Error('publishing the report', { cause: error }));
  }
  const [first, second] = failures;
  if (second) throw new AggregateError(failures, 'qualification failed');
  if (first) throw first;
}
