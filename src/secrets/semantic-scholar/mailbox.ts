// Reading the inbox of the identity a Semantic Scholar key request was
// submitted for, and storing the first key in it Semantic Scholar accepts.
// A candidate is any run of key characters the mail carries that has the
// acquisition contract's shape; whether it is the key is answered by the
// Semantic Scholar API itself, never by the words around it. An API that
// cannot be asked ends the scan with its cause rather than counting the
// candidate as rejected.

import { messagesTo } from '../../utils/email/skrzynka-inbox.js';
import { isWelesAcquiredSecretValue } from '../scoped-service/acquired/value.js';
import { writeWelesAcquiredSecret } from '../scoped-service/acquired/write.js';

export const SEMANTIC_SECRET = 'semantic_scholar.api_key';
const VALIDATION_URL =
  'https://api.semanticscholar.org/graph/v1/paper/search?query=test&limit=1&fields=title';
const KEY_RUN = /[A-Za-z\d._-]+/g;

/** The distinct runs of key characters in `content` that have the Semantic Scholar key's shape. */
export function extractSemanticScholarKeyCandidates(content: string): string[] {
  const normalized = content.replace(/&amp;/g, '&').replace(/<[^>]*>/g, ' ');
  return [...new Set(normalized.match(KEY_RUN))].filter((run) =>
    isWelesAcquiredSecretValue(SEMANTIC_SECRET, Buffer.from(run, 'utf8')),
  );
}

/** Semantic Scholar's answer to a search made with `candidate` as the API key. */
async function validateCandidate(
  candidate: string,
): Promise<{ ok: boolean; status: string }> {
  const response = await fetch(VALIDATION_URL, {
    headers: { 'x-api-key': candidate },
  }).catch((error: unknown) => {
    throw new Error(
      `the Semantic Scholar API could not be asked whether a key from the mail is valid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  });
  return { ok: response.ok, status: `HTTP ${response.status}` };
}

export type MailboxScan =
  | {
      stored: true;
      emailId: string;
      validationStatus: string;
      emailsScanned: number;
      matchedEmails: number;
    }
  | { stored: false; emailsScanned: number; matchedEmails: number };

/**
 * Read every message Skrzynka holds for `target`, newest first, skip those
 * received before `since` (when the submission states when it ran), and
 * store the first candidate the API accepts under the submission's request.
 */
export async function scanMailboxForValidKey(input: {
  target: string;
  since: number | undefined;
  tenantId: string | null;
  requestId: string;
  operation: string;
}): Promise<MailboxScan> {
  const scanned: string[] = [];
  const matched: string[] = [];
  for (const message of await messagesTo(input.target, '')) {
    scanned.push(message.id);
    const receivedAt = Date.parse(message.received_at);
    if (
      input.since !== undefined &&
      Number.isFinite(receivedAt) &&
      receivedAt < input.since
    )
      continue;
    matched.push(message.id);
    const content = `${message.subject}\n${message.body_text}`;
    for (const candidate of extractSemanticScholarKeyCandidates(content)) {
      const secret = Buffer.from(candidate, 'utf8');
      try {
        const validation = await validateCandidate(candidate);
        if (!validation.ok) continue;
        writeWelesAcquiredSecret(
          SEMANTIC_SECRET,
          'api_key',
          secret,
          input.tenantId,
          { requestId: input.requestId, operation: input.operation },
        );
        return {
          stored: true,
          emailId: message.id,
          validationStatus: validation.status,
          emailsScanned: scanned.length,
          matchedEmails: matched.length,
        };
      } finally {
        secret.fill('\0');
      }
    }
  }
  return {
    stored: false,
    emailsScanned: scanned.length,
    matchedEmails: matched.length,
  };
}
