// The journeys' reader of the mail an address received, from Skrzynka, the
// product that holds Wisent's mail. The compiled twin is
// src/utils/email/skrzynka-inbox.ts; both run the same `skrzynka` command and
// answer Skrzynka's own message shape (id, sender, recipients, subject,
// received_at, body_text), newest first. A refusal is Skrzynka's own
// sentence, so a mail-path failure is diagnosed in Skrzynka.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The variable naming the `skrzynka` program, when it is not on PATH. */
const PROGRAM_VARIABLE = 'WELES_SKRZYNKA_BIN';
const PROGRAM = 'skrzynka';
/** The variable naming the Skrzynka organization whose mail Weles reads. */
export const ORGANIZATION_VARIABLE = 'WELES_SKRZYNKA_ORGANIZATION';

function program() {
  const named = process.env[PROGRAM_VARIABLE]?.trim();
  if (named) return named;
  return PROGRAM;
}

/** Whether a journey can read mail at all: an organization is named. */
export function inboxConfigured() {
  return Boolean(process.env[ORGANIZATION_VARIABLE]?.trim());
}

/** What the failed `skrzynka` run said: its stderr when it wrote one. */
function refusal(error) {
  if (typeof error?.stderr === 'string' && error.stderr.trim())
    return error.stderr.trim();
  return error.message;
}

/**
 * The messages Skrzynka holds addressed to `recipient` (the whole address),
 * newest first, keeping only those whose From contains `sender` when one is
 * given (a sender domain such as `discord.com` keeps that domain's mail).
 * Refused, naming the variable, when no organization is configured, and with
 * Skrzynka's own words when it refuses.
 */
export async function messagesTo(recipient, sender) {
  const organization = process.env[ORGANIZATION_VARIABLE]?.trim();
  if (!organization)
    throw new Error(
      `${ORGANIZATION_VARIABLE} names no Skrzynka organization, so the mail to ${recipient} cannot be read`,
    );
  const args = [
    '--organization',
    organization,
    'message',
    'list',
    '--recipient',
    recipient,
  ];
  if (sender) args.push('--sender', sender);
  const command = `${program()} ${args.join(' ')}`;
  let stdout;
  try {
    ({ stdout } = await run(program(), args, { encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`${command} failed: ${refusal(error)}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${command} printed no message list: ${error.message}`);
  }
}
