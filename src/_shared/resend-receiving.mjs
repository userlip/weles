// The receiving provider's own list of what it accepted, read through
// wisent-integrations (`content/resend.receiving.list`); the Resend key stays
// in the integrations service. Only the inbound-domain probe reads it, to
// prove a domain receives at all. What one address received is Skrzynka's to
// answer: journeys read that with src/_shared/mail/skrzynka-inbox.mjs.
import { integrationAction } from './integrations.mjs';

/**
 * The newest messages the provider received, one page of the provider's own
 * size, in Resend's own shape `{ data: [{ id, from, to, subject,
 * created_at }] }`.
 */
export async function listReceived() {
  return integrationAction('content', 'resend.receiving.list', {});
}
