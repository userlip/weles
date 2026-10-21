// Where a run states what it did to a credential: the one file and member a
// credential operation's trajectory writes its answer to, and the reading the
// worker answers the caller from. A run states its answer here or not at all;
// no other file or printed line is read for it.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../session/run-recordings.js';

/** The run's file, under its recordings directory, that carries the answer. */
export const CREDENTIAL_OPERATION_FILE = 'service_action_result.json';
/** The member of that file holding the answer. */
export const CREDENTIAL_OPERATION_MEMBER = 'credential_operation';

/** The indentation of the file a person reads beside the run's recordings. */
const JSON_INDENT = '  ';

/** What every stated answer carries; the caller's contract adds the rest. */
export type CredentialOperationAnswer = {
  /** The credential-operation status the caller's contract declares. */
  status: string;
  /** The sentence the caller is shown. */
  message: string;
  /** Whether the provider's credential changed: none, changed or unknown. */
  providerEffect: string;
  [member: string]: unknown;
};

/** The non-empty text `answer` holds at `member`, refused naming it and `where`. */
function statedText(
  answer: Record<string, unknown>,
  member: keyof CredentialOperationAnswer & string,
  where: string,
): string {
  const value = answer[member];
  if (typeof value !== 'string' || !value)
    throw new Error(
      `credential_operation_incomplete: the ${CREDENTIAL_OPERATION_MEMBER} in ${where} states no ${member}`,
    );
  return value;
}

/**
 * The answer `document` states, refused naming `where` and the member when
 * the document holds no answer object or the answer lacks a member every
 * answer carries.
 */
export function statedCredentialOperation(
  document: unknown,
  where: string,
): CredentialOperationAnswer {
  const answer =
    document && typeof document === 'object'
      ? (document as Record<string, unknown>)[CREDENTIAL_OPERATION_MEMBER]
      : undefined;
  if (!answer || typeof answer !== 'object' || Array.isArray(answer))
    throw new Error(
      `credential_operation_unstated: ${where} holds no ${CREDENTIAL_OPERATION_MEMBER} object, the one place a run states what it did to the credential`,
    );
  const record = answer as Record<string, unknown>;
  return {
    ...record,
    status: statedText(record, 'status', where),
    message: statedText(record, 'message', where),
    providerEffect: statedText(record, 'providerEffect', where),
  };
}

/** State `answer` as this run's credential operation, refused like a reader would refuse it. */
export function writeCredentialOperation(
  answer: CredentialOperationAnswer,
): CredentialOperationAnswer {
  const document = { [CREDENTIAL_OPERATION_MEMBER]: answer };
  const path = join(runRecordingsDir(), CREDENTIAL_OPERATION_FILE);
  statedCredentialOperation(document, path);
  writeFileSync(path, JSON.stringify(document, null, JSON_INDENT));
  return answer;
}
