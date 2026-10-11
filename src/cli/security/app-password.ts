import type { ParsedCli } from '../../cli.js';
import { appPasswordRun } from '../../runtime/api/app-password.js';
import { printAnswer, UsageError } from '../usage.js';

// The command is named for what it issues; the identity provider whose
// account receives the app password is an argument, and google is the one
// implemented. Reading a run back needs only its id.
const PROVIDER = 'google';

export async function runAppPassword(parsed: ParsedCli): Promise<void> {
  if (
    parsed.positional.length ||
    Object.keys(parsed.options).some(
      (key) =>
        key !== 'provider' &&
        key !== 'login-role' &&
        key !== 'login-item' &&
        key !== 'run' &&
        key !== 'organization' &&
        key !== 'account' &&
        key !== 'json',
    )
  ) {
    throw new UsageError(
      'app-password accepts --provider with --login-role or --login-item, --organization and --account, or --run, and --json',
    );
  }
  const loginRole = parsed.options['login-role'];
  const loginItem = parsed.options['login-item'];
  const runId = parsed.options.run;
  const organization = parsed.options.organization;
  const expectedAccount = parsed.options.account;
  if (
    Number(loginRole !== undefined) +
      Number(loginItem !== undefined) +
      Number(runId !== undefined) !==
      1 ||
    (loginRole !== undefined &&
      (typeof loginRole !== 'string' || !loginRole.trim())) ||
    (loginItem !== undefined &&
      (typeof loginItem !== 'string' || !loginItem.trim())) ||
    (runId !== undefined && (typeof runId !== 'string' || !runId.trim()))
  ) {
    throw new UsageError(
      'provide exactly one of --login-role <skarbiec-role>, --login-item <skarbiec-item> or --run <run-id>',
    );
  }
  if (
    runId === undefined &&
    (typeof organization !== 'string' || !organization.trim())
  ) {
    throw new UsageError(
      '--organization <id> names the Skrzynka organization the mailbox is declared in; none is assumed',
    );
  }
  if (
    runId !== undefined &&
    (organization !== undefined ||
      parsed.options.provider !== undefined ||
      expectedAccount !== undefined)
  ) {
    throw new UsageError(
      '--run reads a started run back and takes no --organization, --provider or --account',
    );
  }
  if (runId === undefined && parsed.options.provider !== PROVIDER) {
    throw new UsageError(
      `app-password needs --provider naming the identity provider that issues it; Weles issues through ${PROVIDER}`,
    );
  }
  if (
    runId === undefined &&
    (typeof expectedAccount !== 'string' || !expectedAccount.trim())
  ) {
    throw new UsageError(
      '--account must name the Gmail account the mailbox belongs to',
    );
  }
  const input =
    typeof loginRole === 'string'
      ? {
          loginRole,
          organization: organization as string,
          expectedAccount: expectedAccount as string,
        }
      : typeof loginItem === 'string'
        ? {
            loginItem,
            organization: organization as string,
            expectedAccount: expectedAccount as string,
          }
        : { runId: runId as string };
  const row = await appPasswordRun(input);
  printAnswer(row, parsed.options.json === true);
  if (row.ok === false || row.error) process.exitCode = 1;
}
