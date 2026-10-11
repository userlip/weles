// The mail a session waits for — a sign-up code, a verification link — read
// from Skrzynka, the product that holds Wisent's mail. Skrzynka receives the
// inbound domains accounts are made on and answers its messages by recipient
// and sender; Weles asks it through the `skrzynka` program it already runs
// for app passwords, for the organization the mailbox belongs to. A refusal is
// Skrzynka's own sentence, so a mail-path failure is diagnosed in Skrzynka.
// The journeys' twin is src/_shared/mail/skrzynka-inbox.mjs.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The variable naming the `skrzynka` program, when it is not on PATH. */
const PROGRAM_VARIABLE = 'WELES_SKRZYNKA_BIN';
const PROGRAM = 'skrzynka';
/** The variable naming the Skrzynka organization whose mailboxes Weles reads. */
export const ORGANIZATION_VARIABLE = 'WELES_SKRZYNKA_ORGANIZATION';

/** One stored message as `skrzynka message list` prints it. */
export type InboxMessage = {
  id: string;
  sender: string;
  recipients: string;
  subject: string;
  received_at: string;
  body_text: string;
};

function program(): string {
  const named = process.env[PROGRAM_VARIABLE]?.trim();
  if (named) return named;
  return PROGRAM;
}

/**
 * The messages Skrzynka holds addressed to `recipient` (the whole address,
 * as the To header names it), newest first, keeping only those whose From
 * contains `sender` when one is given. Refused, naming the variable, when no
 * organization is configured, and with Skrzynka's own words when it refuses.
 */
export async function messagesTo(
  recipient: string,
  sender: string,
): Promise<InboxMessage[]> {
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
  let stdout: string;
  try {
    ({ stdout } = await run(program(), args, { encoding: 'utf8' }));
  } catch (error) {
    const said =
      error instanceof Error && 'stderr' in error
        ? String(error.stderr).trim()
        : '';
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`${command} failed: ${said ? said : cause}`);
  }
  try {
    return JSON.parse(stdout) as InboxMessage[];
  } catch (error) {
    throw new Error(
      `${command} printed no message list: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
