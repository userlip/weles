// Running Meta's official Ads CLI (`meta` on PATH) for the Meta Ads
// trajectories: whether it can read (installed and signed in), splitting a
// caller's META_ADS_CLI_ARGS the way a shell would, and running a command
// whose non-zero exit fails the run. Auth and token setup stay Meta's CLI's
// own (`meta auth status`).

import { spawn } from 'node:child_process';

export const META_CLI = 'meta';

/**
 * The words of `text` as a shell would split them: runs of non-space, or a
 * quoted run whose quotes are dropped. A quote that is never closed is
 * refused.
 */
export function splitArgs(text) {
  return Array.from(
    text.matchAll(
      /"(?<dq>[^"]*)"|'(?<sq>[^']*)'|(?<bare>[^\s"']+)|(?<open>["'])/g,
    ),
    ({ groups }) => {
      if (groups.open)
        throw new Error('META_ADS_CLI_ARGS has an unterminated quote');
      return groups.bare ? groups.bare : groups.dq ? groups.dq : groups.sq;
    },
  );
}

function runMeta(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(META_CLI, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

/** Why the Meta CLI cannot read, or null when it is installed and signed in. */
export async function cliUnavailable() {
  let auth;
  let startError;
  try {
    auth = await runMeta(['auth', 'status']);
  } catch (error) {
    startError = error;
  }
  if (startError) return `the meta CLI could not start: ${startError.message}`;
  if (!auth.code) return null;
  return `meta auth status exited ${auth.code}: ${(auth.err ? auth.err : auth.out).trim()}`;
}

/** Run `meta <args>`, printing what it answers; a non-zero exit is thrown. */
export async function runMetaCommand(label, args) {
  console.log(
    `[${label}] ${META_CLI} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
  );
  const result = await runMeta(args);
  if (result.out) console.log(result.out.trim());
  if (result.err) console.error(result.err.trim());
  if (result.code)
    throw new Error(`META_CLI_FAILED: meta CLI exited ${result.code}`);
}
