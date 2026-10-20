import { isRequestId } from '../../../../dist/secrets/request-id.js';
import { MICROSOFT_PASSWORD_ID, PASSWORD_FIELD } from './constants.mjs';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A non-empty string, or undefined. */
function stated(value) {
  return typeof value === 'string' && value ? value : undefined;
}

/** The exact Skarbiec contract this run carries, or a refusal when any field is off. */
export function constraints(expectedOperation) {
  const text = process.env.WELES_CREDENTIAL_CONSTRAINTS;
  if (!text)
    throw new Error(
      'WELES_CREDENTIAL_CONSTRAINTS is not set: a Microsoft password operation runs only under its exact Skarbiec contract',
    );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `invalid Weles credential constraints: not JSON: ${error.message}`,
      { cause: error },
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid Weles credential constraints: not an object');
  }
  const credentialId = stated(parsed.secret);
  const operation = stated(parsed.operation);
  const accountEmail = stated(parsed.account_email)?.trim().toLowerCase();
  if (
    !credentialId ||
    !MICROSOFT_PASSWORD_ID.test(credentialId) ||
    operation !== expectedOperation ||
    !accountEmail ||
    !EMAIL.test(accountEmail) ||
    parsed.vault_item_id !== credentialId ||
    parsed.vault_field !== PASSWORD_FIELD ||
    !isRequestId(parsed.request_id) ||
    parsed.provider !== 'microsoft'
  ) {
    throw new Error(
      'Microsoft password operation is outside its exact Skarbiec contract',
    );
  }
  return {
    credentialId,
    operation,
    accountEmail,
    tenantId: stated(parsed.tenant_id),
    requestId: parsed.request_id,
  };
}

/** The account's sign-in email: its metadata email, else its username. */
export function accountEmail(account) {
  const email = stated(account.metadata?.email) ?? stated(account.username);
  if (!email)
    throw new Error(
      `account ${account.id} has neither a metadata email nor a username to sign in with`,
    );
  return email.trim().toLowerCase();
}

/** Whether the queued account is the one the contract names, credential reference included. */
export function accountMatchesContract(account, contract) {
  const metadata = account?.metadata;
  return (
    accountEmail(account) === contract.accountEmail &&
    metadata?.skarbiec_credential_id === contract.credentialId &&
    stated(metadata?.skarbiec_tenant_id) === contract.tenantId
  );
}
