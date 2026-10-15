// Where the certificate request and the issued certificate live during one
// create_developer_id run.
//
// A caller that runs on another machine (weles apple developer-id) sends the
// request itself as APPLE_CSR_BASE64 — a CSR is public, the private key never
// leaves the caller — and the run places it in its own output directory, owner
// only, and removes that directory when it ends. A caller already on this
// host may instead name both files with APPLE_CSR_PATH / APPLE_CERTIFICATE_PATH.

import { constants, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { runOutputPath } from '#run-output';
import { statedText } from '../../_shared/inputs/stated.mjs';

const CSR_HEADER = '-----BEGIN CERTIFICATE REQUEST-----';
const OWNER_ONLY_DIRECTORY = constants.S_IRWXU;
const OWNER_ONLY_FILE = constants.S_IRUSR | constants.S_IWUSR;

/** A worker-side path stated in `variable`: absolute, or ~/ expanded. */
function workerPath(variable, what) {
  const value = statedText([variable], what);
  const expanded = value.startsWith('~/') ? join(homedir(), value.slice('~/'.length)) : value;
  if (!isAbsolute(expanded)) throw new Error(`[apple-create-developer-id] ${variable} must be absolute or start with ~/`);
  return expanded;
}

/** The request and certificate paths of this run, and how to remove what it placed. */
export function placeRequestFiles(guardId) {
  const encoded = process.env.APPLE_CSR_BASE64 && process.env.APPLE_CSR_BASE64.trim();
  if (!encoded)
    return {
      csrPath: workerPath('APPLE_CSR_PATH', 'the certificate request on this host (or APPLE_CSR_BASE64 with the request itself)'),
      certificatePath: workerPath('APPLE_CERTIFICATE_PATH', 'where the issued certificate is saved on this host'),
      cleanup: () => undefined,
    };
  const request = Buffer.from(encoded, 'base64').toString('utf8');
  if (!request.startsWith(CSR_HEADER))
    throw new Error('[apple-create-developer-id] APPLE_CSR_BASE64 is not a PEM certificate request');
  const directory = runOutputPath('apple-developer-id', guardId);
  mkdirSync(directory, { recursive: true, mode: OWNER_ONLY_DIRECTORY });
  const csrPath = join(directory, 'request.csr');
  writeFileSync(csrPath, request, { mode: OWNER_ONLY_FILE });
  return {
    csrPath,
    certificatePath: join(directory, 'certificate.cer'),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
