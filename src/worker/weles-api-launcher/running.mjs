/**
 * Running things, and stopping when one of them cannot run.
 *
 * A launcher that swallowed a failed child would leave the unit reported as
 * active while nothing serves, so every refusal here ends the process with a
 * sentence naming what failed.
 */
import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';

const EXIT_SUCCESS = 0; // https://pubs.opengroup.org/onlinepubs/9799919799/functions/exit.html EXIT_SUCCESS
const EXIT_FAILURE = 1; // https://pubs.opengroup.org/onlinepubs/9799919799/functions/exit.html EXIT_FAILURE

export function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(EXIT_FAILURE);
}

/** Announce the operation before waiting; retain its completion separately. */
function beginStep(label) {
  const began = new Date();
  const step = {
    operation: label,
    pid: process.pid,
    began_at: began.toISOString(),
  };
  process.stdout.write(`${JSON.stringify({ startup_step: step })}\n`);
  return () => {
    const ended = new Date();
    process.stdout.write(
      `${JSON.stringify({ startup_step: { ...step, ended_at: ended.toISOString(), duration_ms: ended - began } })}\n`,
    );
  };
}

export function runCommand(command, args, label) {
  const end = beginStep(label);
  try {
    return spawnSync(command, args, { encoding: 'utf8', env: process.env });
  } finally {
    end();
  }
}

export async function runAsync(label, operation) {
  const end = beginStep(label);
  try {
    return await operation();
  } catch (error) {
    throw new Error(
      `${label}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    end();
  }
}

export function run(command, args, label) {
  const result = runCommand(command, args, label);
  if (result.error) refuse(`${label} could not run: ${result.error.message}`);
  if (result.status !== EXIT_SUCCESS) {
    let ended = `exit ${result.status}`;
    if (result.status === null) ended = `signal ${result.signal}`;
    // Stdout is never quoted: the Skarbiec acquisitions run here print the
    // secret they acquired on it. Its length says whether it said anything.
    const said = result.stderr.trim();
    refuse(
      `${label} refused (${ended}): ${said === '' ? 'nothing on stderr' : said}; ${result.stdout.length} characters on stdout`,
    );
  }
  return result.stdout.trim();
}

// Why `path` is not a regular file, or null when it is: a missing file and one
// that cannot be examined (permissions, I/O) are different refusals.
export function notAFile(path) {
  try {
    return statSync(path).isFile() ? null : 'is not a regular file';
  } catch (error) {
    return error.code === 'ENOENT'
      ? 'does not exist'
      : `cannot be examined: ${error.message}`;
  }
}
