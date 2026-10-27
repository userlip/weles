import { updateAccount } from '../state/skarbiec-records.js';

/** What deactivating a banned account came to. */
export type Deactivation =
  | { deactivated: true; account: string }
  | { deactivated: false; cause: string };

/**
 * Mark a trajectory account inactive in Skarbiec after a hard ban signal, and
 * say what happened: the account deactivated, or why it was not -- the run
 * named no account, Skarbiec holds no account under that id, or Skarbiec
 * refused the write. A caller reports the ban with this outcome, so a ban
 * whose account stayed active is never reported as deactivated.
 */
export async function deactivateAccount(
  accountId: string | undefined | null,
  currentMetadata: Record<string, any> | undefined,
  reason: string,
): Promise<Deactivation> {
  if (!accountId)
    return {
      deactivated: false,
      cause: `the run named no account to deactivate (${reason})`,
    };
  const metadata = {
    ...currentMetadata,
    banned_reason: reason,
    banned_at: new Date().toISOString(),
  };
  const id = accountId;
  return Promise.resolve()
    .then(() => updateAccount(id, { active: false, metadata }))
    .then(
      (held): Deactivation => {
        if (!held) {
          console.log(`[account-state] deactivate ${id}: no such account`);
          return {
            deactivated: false,
            cause: `Skarbiec holds no account ${id}`,
          };
        }
        console.log(`[account-state] deactivated ${id} (${reason})`);
        return { deactivated: true, account: id };
      },
      (refused: unknown): Deactivation => {
        const message =
          refused instanceof Error ? refused.message : String(refused);
        console.log(`[account-state] deactivate ${id} refused: ${message}`);
        return {
          deactivated: false,
          cause: `Skarbiec refused deactivating account ${id}: ${message}`,
        };
      },
    );
}

/** The clause a ban refusal ends with: the account deactivated, or why not. */
export function deactivationClause(
  outcome: Deactivation,
  username: string,
): string {
  return outcome.deactivated
    ? `${username} is deactivated`
    : `${username} is still active: ${outcome.cause}`;
}
