import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The status of a program that did what it was asked. */
const EXIT_SUCCESS = 0; // https://pubs.opengroup.org/onlinepubs/9799919799/functions/exit.html EXIT_SUCCESS

function executable(path, label, allowSymlink = false) {
  if (!isAbsolute(path)) throw new Error(`${label} path must be absolute`);
  let metadata;
  try {
    metadata = allowSymlink ? statSync(path) : lstatSync(path);
    accessSync(path, constants.X_OK);
  } catch (error) {
    throw new Error(
      `${label} ${JSON.stringify(path)} is unavailable or not executable: ${error.message}`,
      { cause: error },
    );
  }
  if (!metadata.isFile() || (!allowSymlink && metadata.isSymbolicLink())) {
    throw new Error(
      `${label} must be ${allowSymlink ? 'a regular executable' : 'a regular non-symlink executable'}`,
    );
  }
  return path;
}

/**
 * The value of an environment variable the caller set, trimmed; `undefined`
 * when it is unset. A variable set but empty is refused by name: read as
 * unset, it would send the lookup to the next source.
 */
function setting(name) {
  const value = process.env[name];
  if (value === undefined) return undefined;
  if (value.trim() === '') {
    throw new Error(`${name} is set but empty; name the program or unset it`);
  }
  return value.trim();
}

/**
 * The Stado program: the one WELES_STADO_BIN or STADO_BIN names, else the
 * one Stado installs into the account's ~/.stado/bin.
 */
export function stadoBinary() {
  const configured = setting('WELES_STADO_BIN') ?? setting('STADO_BIN');
  if (configured !== undefined)
    return executable(configured, 'Stado binary', true);
  return executable(
    join(homedir(), '.stado', 'bin', 'stado'),
    'Stado binary installed by Stado',
    true,
  );
}

/** Every reason a Stado run gave for failing, in its own words. */
function said(result) {
  const reasons = [
    result.error?.message,
    result.signal ? `ended by ${result.signal}` : undefined,
    result.stderr?.trim(),
    result.stdout?.trim(),
  ].filter(Boolean);
  return reasons.length
    ? reasons.join('\n')
    : 'Stado wrote nothing on stdout or stderr';
}

function stadoJson(args, operation) {
  // A Stado answer is read whole: no size is imposed on it.
  const result = spawnSync(stadoBinary(), args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: Infinity,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== EXIT_SUCCESS) {
    throw new Error(
      `Stado ${operation} failed (exit ${result.status}): ${said(result)}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `Stado ${operation} returned invalid JSON: ${error.message}; stdout: ${result.stdout}; stderr: ${result.stderr}`,
    );
  }
}

/** A lowercase hex SHA-256 digest, as long as the digest is. */
const digestLength = createHash('sha256').digest('hex').length;
const exactDigest = (value) =>
  typeof value === 'string' &&
  value.length === digestLength &&
  /^[\da-f]+$/.test(value);
/** A name Stado gives a target, version or platform: no separators or spaces. */
const exactName = (value) =>
  typeof value === 'string' && /^[A-Za-z\d][\w.-]*$/.test(value);
const sameKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...keys].sort().join('|');

/** A signed release Stado attests for this host. */
function attestedRelease(active) {
  const keys = [
    'artifact_sha256',
    'manifest_sha256',
    'path',
    'platform',
    'product',
    'state',
    'target',
    'version',
  ];
  return (
    sameKeys(active, keys) &&
    active.state === 'active' &&
    active.product === 'skarbiec' &&
    exactName(active.target) &&
    exactName(active.version) &&
    exactName(active.platform) &&
    exactDigest(active.artifact_sha256) &&
    exactDigest(active.manifest_sha256) &&
    typeof active.path === 'string'
  );
}

/**
 * The program the host itself declares and reports for Skarbiec, when no
 * signed release targets it. That is the fleet's vault owner: there the
 * running vault is a host-declared program, not a rollout, and requiring a
 * release would keep weles-admission down. The bytes on disk must still be
 * the bytes Stado's host report names, so a replaced or tampered file is
 * refused.
 */
function declaredProgram(active) {
  const keys = ['path', 'product', 'sha256', 'state', 'target', 'version'];
  if (
    !sameKeys(active, keys) ||
    active.state !== 'declared' ||
    active.product !== 'skarbiec' ||
    !exactName(active.target) ||
    !exactName(active.version) ||
    !exactDigest(active.sha256) ||
    typeof active.path !== 'string'
  ) {
    return false;
  }
  const managed = join(homedir(), '.stado', 'bin', 'skarbiec');
  if (active.path !== managed) return false;
  const onDisk = createHash('sha256')
    .update(readFileSync(active.path))
    .digest('hex');
  if (onDisk !== active.sha256) {
    throw new Error(
      `Skarbiec at ${active.path} has digest ${onDisk}, not the ${active.sha256} Stado's host report names`,
    );
  }
  return true;
}

export function activeSkarbiecBinary() {
  // The managed launcher already resolved this executable through Stado.
  const inherited = setting('SKARBIEC_BIN');
  if (inherited !== undefined)
    return executable(inherited, 'launcher-provided Skarbiec binary');
  const active = stadoJson(
    ['release', 'active', 'binary', 'skarbiec', '--json'],
    'active Skarbiec release lookup',
  );
  if (attestedRelease(active))
    return executable(active.path, 'attested active Skarbiec binary');
  if (declaredProgram(active))
    return executable(active.path, 'host-declared Skarbiec binary');
  throw new Error(
    `Stado names neither an attested Skarbiec release nor the host's own declared Skarbiec: ${JSON.stringify(active)}`,
  );
}

/**
 * Whether `hostname` is an address this machine holds on its loopback
 * interface, as the system reports its interfaces (internal ones are the
 * loopback). A name is not resolved to decide it.
 */
export function loopbackAddress(hostname) {
  const address = hostname.replace(/^\[|\]$/g, '');
  return Object.values(networkInterfaces())
    .flat()
    .some((entry) => entry.internal && entry.address === address);
}

export function skarbiecDirectoryEndpoint() {
  const record = stadoJson(
    ['service', 'directory', 'endpoint', 'skarbiec', '--json'],
    'Skarbiec service-directory lookup',
  );
  if (
    record?.service !== 'skarbiec' ||
    typeof record?.url !== 'string' ||
    !record.url
  ) {
    throw new Error(
      `Stado service directory has no Skarbiec endpoint: ${JSON.stringify(record)}`,
    );
  }
  let endpoint;
  try {
    endpoint = new URL(record.url);
  } catch (error) {
    throw new Error(
      `Stado service directory returned an invalid Skarbiec endpoint ${JSON.stringify(record.url)}: ${error.message}`,
      { cause: error },
    );
  }
  if (
    (endpoint.protocol !== 'https:' && !loopbackAddress(endpoint.hostname)) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.pathname !== '/' && endpoint.pathname !== '')
  ) {
    throw new Error(
      `Stado service directory returned an unsafe Skarbiec endpoint ${JSON.stringify(record.url)}: it must be HTTPS or on a loopback address of this machine, with no credentials, path, query or fragment`,
    );
  }
  return endpoint.toString().replace(/\/$/, '');
}

/**
 * The capability broker socket of the shared Skarbiec on this host, as Stado
 * declares the Skarbiec unit's environment here. Never an inherited
 * variable: the per-Weles broker it used to name was retired, and a socket
 * left in an env file from that time is one nothing serves.
 */
export function sharedCapabilitySocket() {
  const self = spawnSync(stadoBinary(), ['registry', 'self', '--name-only'], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const host = self.stdout?.trim();
  if (self.error || self.status !== EXIT_SUCCESS || !host) {
    throw new Error(
      `Stado could not name this host's registry target (exit ${self.status}): ${said(self)}`,
    );
  }
  const units = stadoJson(
    ['service', 'env', 'show', 'skarbiec', '--host', host, '--json'],
    `Skarbiec unit environment on ${host}`,
  );
  if (!Array.isArray(units)) {
    throw new Error(
      `Stado's Skarbiec unit environment on ${host} is not a list of units: ${JSON.stringify(units)}`,
    );
  }
  const [unit, ...others] = units;
  if (unit === undefined || others.length) {
    throw new Error(
      `Stado declares ${units.length} Skarbiec units on ${host}; the capability socket is read from exactly one`,
    );
  }
  const socket = unit.environment?.SKARBIEC_CAP_SOCKET;
  if (typeof socket !== 'string' || !isAbsolute(socket)) {
    throw new Error(
      `Stado declares no absolute SKARBIEC_CAP_SOCKET for the Skarbiec unit on ${host}`,
    );
  }
  return socket;
}

const [, script, action] = process.argv;
if (script && import.meta.url === pathToFileURL(script).href) {
  if (action === 'active-binary') process.stdout.write(activeSkarbiecBinary());
  else if (action === 'endpoint')
    process.stdout.write(skarbiecDirectoryEndpoint());
  else if (action === 'capability-socket')
    process.stdout.write(sharedCapabilitySocket());
  else
    throw new Error(
      'usage: skarbiec-runtime.mjs active-binary|endpoint|capability-socket',
    );
}
