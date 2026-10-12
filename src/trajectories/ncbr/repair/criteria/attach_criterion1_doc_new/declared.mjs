// What a criterion-1 run is told, every value stated by its caller and refused
// by name when absent: no mode, package folder or field limit is assumed.
//
// The package is the folder NCBR_CRITERION1_PACKAGE_DIR names; its PDFs, in
// file-name order, are the attachments in attachment order. The limits are the
// ones the live LSI2 field declares for the application, stated by the caller
// for MODE=apply as NCBR_CRITERION1_MAX_FILES and NCBR_CRITERION1_MAX_FILE_BYTES.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';

const READ = 'read';
const APPLY = 'apply';

function stated(name, meaning) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required: ${meaning}`);
  return value;
}

function statedCount(name, meaning) {
  const value = Number(stated(name, meaning));
  if (!Number.isInteger(value) || value <= Number.MIN_VALUE)
    throw new Error(`${name} must be a positive whole number: ${meaning}`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The run's mode, package and, for MODE=apply, the field's limits. */
export function declaredRun() {
  const mode = stated(
    'MODE',
    `${READ} compares the saved row, ${APPLY} saves the package`,
  );
  if (mode !== READ && mode !== APPLY)
    throw new Error(`Unsupported MODE=${mode}: state ${READ} or ${APPLY}`);
  const resumeStaged = process.env.RESUME_STAGED === '1';
  if (resumeStaged && mode !== APPLY)
    throw new Error(`RESUME_STAGED requires MODE=${APPLY}`);
  const dir = stated(
    'NCBR_CRITERION1_PACKAGE_DIR',
    'the folder holding the criterion-1 PDFs, named in attachment order',
  );
  const names = readdirSync(dir)
    .filter((name) => extname(name).toLowerCase() === '.pdf')
    .sort();
  if (!names.length)
    throw new Error(`no PDF in NCBR_CRITERION1_PACKAGE_DIR=${dir}`);
  const files = names.map((name) => {
    const path = join(dir, name);
    const info = statSync(path);
    if (!info.isFile()) throw new Error(`${path} is not a regular file`);
    return { name, path, bytes: info.size, sha256: sha256(readFileSync(path)) };
  });
  if (mode === APPLY) {
    const maxFiles = statedCount(
      'NCBR_CRITERION1_MAX_FILES',
      'the PDFs the live criterion-1 field accepts per collection row',
    );
    const maxBytes = statedCount(
      'NCBR_CRITERION1_MAX_FILE_BYTES',
      'the bytes the live criterion-1 field accepts per PDF',
    );
    const oversize = files.filter((file) => file.bytes > maxBytes);
    if (oversize.length)
      throw new Error(
        `pliki ponad limit ${maxBytes} B: ${oversize.map((file) => `${file.name} (${file.bytes} B)`).join('; ')}`,
      );
    if (files.length > maxFiles)
      throw new Error(
        `paczka ma ${files.length} plikow, a pole przyjmuje ${maxFiles} na wiersz kolekcji; rozloz zestaw na dwa wiersze kolekcji albo polacz dokumenty w rodziny`,
      );
  }
  return { mode, read: mode === READ, resumeStaged, dir, files };
}

/** The caller's message for an error of any shape. */
export function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}
