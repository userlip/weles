// The credentials a generic browser task fills before its agent starts:
// each credential_prefill entry of the task's constraints names a target, a
// field class and a single-use Skarbiec capability. A field the page does
// not show leaves its capability unspent and the entry with the agent; a
// fill that does not land after the capability is redeemed fails the task.
import { CREDENTIAL_FIELD_ABSENT } from '../../../../../dist/session/wsession-helpers/finalize.js';

/**
 * Fill the prefill entries the page shows, record each in `initialHistory`,
 * leave the rest in the constraints, and answer the fills that landed.
 */
export async function applyCredentialPrefill(session, constraints, initialHistory) {
  const entries = Array.isArray(constraints.credential_prefill)
    ? constraints.credential_prefill
    : [];
  const pending = [];
  const completed = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('credential_prefill entries must be objects');
    const { target, field_class: fieldClass, capability } = entry;
    if (
      typeof target !== 'string' ||
      !target ||
      typeof fieldClass !== 'string' ||
      !fieldClass ||
      !capability ||
      typeof capability !== 'object' ||
      Array.isArray(capability)
    )
      throw new Error('credential_prefill entry is incomplete: it needs a target, a field_class and a capability');
    const outcome = await session.fillCredential(target, fieldClass, capability);
    if (outcome === CREDENTIAL_FIELD_ABSENT) {
      pending.push(entry);
      console.log(
        `[generic] prefill deferred: no ${fieldClass} field on this page; its capability is unspent`,
      );
    } else if (outcome.startsWith('credential filled')) {
      completed.push({ target, field_class: fieldClass });
      initialHistory.push({
        tool: 'fill_credential',
        args: { target, field_class: fieldClass },
        result: outcome,
      });
    } else {
      throw new Error(
        `credential prefill for ${fieldClass} did not fill its target after redemption: ${outcome}`,
      );
    }
  }
  constraints.credential_prefill = pending;
  return completed;
}
