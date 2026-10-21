// A trajectory's own service credentials (src/_shared/scoped-secrets/
// services.mjs): each field is read through the workload-bound Skarbiec
// acquisition the TypeScript transport performs
// (src/secrets/scoped-service/transport.ts readAcquiredField), asking for the
// role the credential plays, and a writable service's fields are written to
// the item playing that role with its own writer identity. Without Skarbiec,
// the owner-only WELES_CREDENTIALS_FILE holds the fields under the role name.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import {
  checkedTokenFile,
  readAcquiredField,
  skarbiecEndpoint,
} from '../../dist/secrets/scoped-service/transport.js';
import { stadoBinary } from './skarbiec-runtime.mjs';
import {
  localCredentialsFile,
  readLocalField,
  writeLocalFields,
} from './local-credentials.mjs';
import { SERVICES } from './scoped-secrets/services.mjs';

/** The service `serviceName` names, refused by name when none is declared. */
function declaredService(serviceName) {
  if (!Object.hasOwn(SERVICES, serviceName))
    throw new Error(
      `unknown Weles scoped secret service: ${serviceName}; declare it in src/_shared/scoped-secrets/services.mjs`,
    );
  return SERVICES[serviceName];
}

/** The service, refused unless its credential holds a username and password. */
function loginService(serviceName) {
  const service = declaredService(serviceName);
  if (
    !Object.hasOwn(service.fields, 'username') ||
    !Object.hasOwn(service.fields, 'password')
  )
    throw new Error(
      `service is not an exact Weles scoped login contract: ${serviceName}`,
    );
  return service;
}

export function readScopedSecret(serviceName, field) {
  const service = declaredService(serviceName);
  if (!Object.hasOwn(service.fields, field))
    throw new Error(
      `field is not in the exact Weles scoped secret contract: ${serviceName}/${field}`,
    );
  // The local file names a field it does not hold, by item and field.
  const local = localCredentialsFile();
  if (local) return readLocalField(local, service.item, field);
  const value = readAcquiredField(
    service.consumer,
    service.item,
    field,
    undefined,
    `role:${service.item}`,
  );
  // The transport reads nothing only when this process carries no workload
  // identity to acquire with.
  if (value === undefined)
    throw new Error(
      `Skarbiec workload identity is required to read ${serviceName}/${field}: set SKARBIEC_WORKLOAD_ID and SKARBIEC_WORKLOAD_SIGNING_KEY_FILE, or WELES_CREDENTIALS_FILE on a machine without Skarbiec`,
    );
  return value;
}

/** The service, refused by name unless it declares a writer identity. */
function writableService(serviceName) {
  const service = declaredService(serviceName);
  if (!service.writerConsumer || !service.writerTokenFile)
    throw new Error(
      `no exact Weles scoped secret writer contract exists for ${serviceName}`,
    );
  return service;
}

/** The writer token file of `serviceName`, refused by name when not issued. */
function writerTokenFile(serviceName, service) {
  const tokenFile = checkedTokenFile(service.writerTokenFile);
  if (tokenFile === null)
    throw new Error(
      `the scoped Skarbiec writer token file ${service.writerTokenFile} for ${serviceName} has not been issued`,
    );
  return tokenFile;
}

export function assertScopedSecretWriter(serviceName) {
  const service = writableService(serviceName);
  if (localCredentialsFile()) return;
  skarbiecEndpoint();
  writerTokenFile(serviceName, service);
}

/** One line of text: what a scoped field may hold. */
function fieldValue(serviceName, field, value) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\r\n]/.test(value) ||
    value.includes('\0')
  )
    throw new Error(
      `refusing invalid scoped secret write for ${serviceName}/${field}: the value must be one line of text`,
    );
  return value.trim();
}

export function writeScopedSecretItem(serviceName, fields) {
  const service = writableService(serviceName);
  if (!fields || typeof fields !== 'object')
    throw new Error(
      `write for ${serviceName} needs an object of its fields ${Object.keys(service.fields).join(', ')}`,
    );
  const entries = Object.entries(fields);
  if (
    entries.length !== Object.keys(service.fields).length ||
    entries.some(([field]) => !Object.hasOwn(service.fields, field))
  )
    throw new Error(
      `write does not match the exact Weles scoped secret contract for ${serviceName}: it must carry exactly ${Object.keys(service.fields).join(', ')}`,
    );
  const normalized = Object.fromEntries(
    entries.map(([field, value]) => [
      field,
      fieldValue(serviceName, field, value),
    ]),
  );
  const local = localCredentialsFile();
  if (local) {
    writeLocalFields(local, service.item, normalized);
    return;
  }
  const input = Buffer.from(JSON.stringify(normalized));
  try {
    const result = spawnSync(
      stadoBinary(),
      ['secrets', 'put', '--role', service.item],
      {
        input,
        encoding: 'buffer',
        maxBuffer: Infinity,
        stdio: ['pipe', 'ignore', 'pipe'],
        env: {
          HOME: homedir(),
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          WC_SKARBIEC_URL: skarbiecEndpoint(),
          WC_SKARBIEC_CONSUMER: service.writerConsumer,
          WC_SKARBIEC_TOKEN_FILE: writerTokenFile(serviceName, service),
        },
      },
    );
    if (result.error || result.status || result.signal) {
      const exited = result.error
        ? `could not run: ${result.error.message}`
        : result.signal
          ? `was ended by signal ${result.signal}`
          : `exited with status ${result.status}`;
      const said = result.stderr.toString('utf8').trim();
      throw new Error(
        `scoped Skarbiec write failed for ${serviceName}: stado secrets put ${exited}${said ? `: ${said}` : ' and wrote nothing to stderr'}`,
      );
    }
  } finally {
    // An empty string zero-fills a Buffer.
    input.fill('');
  }
}

export function writeScopedLogin(serviceName, login) {
  const service = loginService(serviceName);
  writeScopedSecretItem(serviceName, {
    username: login.email,
    password: login.password,
    ...(Object.hasOwn(service.fields, 'totp_secret')
      ? { totp_secret: login.totpSecret }
      : {}),
  });
}

export function readScopedLogin(serviceName) {
  const service = loginService(serviceName);
  const email = readScopedSecret(serviceName, 'username');
  const password = readScopedSecret(serviceName, 'password');
  if (!Object.hasOwn(service.fields, 'totp_secret')) return { email, password };
  return {
    email,
    password,
    totpSecret: readScopedSecret(serviceName, 'totp_secret'),
  };
}

export function readScopedProxy(serviceName) {
  return {
    username: readScopedSecret(serviceName, 'username'),
    password: readScopedSecret(serviceName, 'password'),
  };
}
