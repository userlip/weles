// Whether the running task asks Weles to store a credential in Skarbiec, read
// from the constraints the task was started with. A task that states no
// constraints has none; it is never read as an empty object standing in for
// them.

import type { WelesAcquiredSecret } from '../../../secrets/scoped-service.js';

export type CredentialFieldClass = 'token' | 'api-key' | 'password';

/** What the task permits Weles to store, as read from its constraints. */
export type StoreConstraints = {
  secretName: WelesAcquiredSecret;
  itemId: string;
  field: string;
  fieldClass: CredentialFieldClass;
  // Present exactly when Skarbiec recorded a signup origin for this operation:
  // the managed write must then echo that string back, and must not send one when
  // the operation declared none.
  declaredOrigin: string | undefined;
  // The origin the contract pins or the task states; absent, the live page's.
  sourceOrigin: string | undefined;
  tenantId: string | undefined;
  accountEmail: string | undefined;
  requestId: string;
  operation: string;
};

function stated(value: string | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

/** The task's credential constraints as written, or null when it states none.
 * Two sources stating them at once are refused. */
export function credentialConstraintsText(): string | null {
  const [only, second] = [
    process.env.GENERIC_TASK_CONSTRAINTS,
    process.env.WELES_CREDENTIAL_CONSTRAINTS,
  ].filter(stated);
  if (second !== undefined) {
    throw new Error('multiple credential constraint sources are not allowed');
  }
  return only === undefined ? null : only;
}

/**
 * Whether the task asks for a credential to be stored in Skarbiec. Constraints
 * that are not JSON are refused naming their cause, since they cannot say
 * whether they ask for one.
 */
export function isSkarbiecCredentialTask(): boolean {
  if (stated(process.env.WELES_CREDENTIAL_CONSTRAINTS)) return true;
  const text = credentialConstraintsText();
  if (text === null) return false;
  let constraints: unknown;
  try {
    constraints = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `the task's credential constraints are not JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return Boolean(
    constraints &&
      typeof constraints === 'object' &&
      !Array.isArray(constraints) &&
      'store_secret_target' in constraints &&
      constraints.store_secret_target === 'skarbiec',
  );
}
