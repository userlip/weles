import {
  inboxConfigured as skrzynkaConfigured,
  messagesTo,
} from '../../../_shared/mail/skrzynka-inbox.mjs';

/** The sender Pangram's verification mail comes from. */
const PANGRAM_SENDER = 'pangram';

/** Whether an inbox is configured for the verification mail at all. */
export function inboxConfigured() {
  return skrzynkaConfigured();
}

/**
 * The ids of the messages Skrzynka already holds from Pangram for `email`,
 * read before signup: the verification mail is the one that is not among
 * them, so no clock tolerance decides which message is new.
 */
export async function inboxIdsFor(email) {
  const inbox = await messagesTo(email, PANGRAM_SENDER);
  return new Set(inbox.map((m) => m.id));
}

/**
 * One read of Skrzynka for Pangram's verification mail to `email` that was
 * not there before signup (`seenBefore`). Returns the code and the Pangram
 * link it carries, or null when it has not arrived; the caller decides what a
 * missing mail means instead of this waiting.
 */
export async function readPangramMail(email, seenBefore) {
  const inbox = await messagesTo(email, PANGRAM_SENDER);
  const hit = inbox.find((m) => !seenBefore.has(m.id));
  if (!hit) return null;
  const text = `${hit.subject}\n${hit.body_text}`;
  const codeMatch = text.match(/\b\d{5,6}\b/);
  const links = [...text.matchAll(/https?:\/\/[^\s"'<>]+/g)].map((m) =>
    m[0].replace(/&amp;/g, '&'),
  );
  const pangramLink = links.find((u) => /pangram\.com/i.test(u));
  return {
    id: hit.id,
    subject: hit.subject,
    code: codeMatch ? codeMatch[0] : null,
    pangramLink: pangramLink === undefined ? null : pangramLink,
  };
}
