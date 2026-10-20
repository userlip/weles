// The queued Entra password job: which exact Skarbiec contract this run may
// execute, which Skarbiec account row it is bound to, and which Entra-owned
// surfaces the operation lives on.
//
// Moved out of entra_password_lifecycle.mjs, which keeps the three trajectory
// entry points.

import { randomUUID } from 'node:crypto';
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../../dist/utils/credentials.js';
import { updateAccount } from '../../../../dist/state/skarbiec-records.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { isRequestId } from '../../../../dist/secrets/request-id.js';

// The Skarbiec item of one Entra account's password: a DNS-label-shaped name
// between the Weles Microsoft prefix and the password suffix.
const ENTRA_PASSWORD_ID =
  /^weles-microsoft-[a-z\d](?:[a-z\d-]*[a-z\d])?-password$/;
const ENTRA_PROVIDER = 'microsoft_entra';
export const PASSWORD_FIELD = 'password';
export const SIGN_IN_ORIGIN = 'https://login.microsoftonline.com';
export const AUTHORIZED_CONTEXT_URL = 'https://myaccount.microsoft.com/';
export const AUTHORIZED_CONTEXT_HOST = /(^|\.)myaccount\.microsoft\.com$/;
export const AUTHORIZED_CONTEXT_URL_PATTERN =
  /^https:\/\/myaccount\.microsoft\.com\//;
export const CHANGE_PASSWORD_URL =
  'https://account.activedirectory.windowsazure.com/ChangePassword.aspx';
export const SELF_SERVICE_RESET_URL =
  'https://passwordreset.microsoftonline.com/';
const SIGN_IN_HOSTS = Object.freeze([
  'login.microsoftonline.com',
  'login.microsoft.com',
]);
export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** A UUID's shape (hexadecimal groups between hyphens), read from a UUID. */
const UUID_SHAPE = randomUUID().replace(/[\da-f]/g, '[\\da-f]');
export const LOWER_UUID = new RegExp(`^${UUID_SHAPE}$`);
const ACTION_LOG_ID = new RegExp(`^${UUID_SHAPE}$`, 'i');

// The queued row carries two unrelated tenants. The directory block is the
// item's own write-once identity contract (the Entra directory the principal
// lives in, asserted against token claims), while constraints.weles_tenant_id is
// the Weles/Skarbiec binding tenant used to resolve the scoped reader and
// writer. Never cross them, and never take the identity from anywhere but the
// directory block: a missing or partial block is a refusal, not a default.
export function constraints(allowedOperations) {
  const text = process.env.WELES_CREDENTIAL_CONSTRAINTS;
  if (!text)
    throw new Error(
      'WELES_CREDENTIAL_CONSTRAINTS is not set: an Entra password operation runs only under its exact Skarbiec contract',
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
  const directory = parsed.directory;
  if (!directory || typeof directory !== 'object' || Array.isArray(directory)) {
    throw new Error(
      'Entra password operation carries no directory identity contract',
    );
  }
  const credentialId = stated(parsed.secret);
  const operation = stated(parsed.operation);
  const accountEmail = lowered(parsed.account_email);
  const accountUpn = lowered(directory.account_upn);
  const tenantId = lowered(directory.tenant_id);
  const principalObjectId = lowered(directory.principal_object_id);
  const actionLogId = stated(process.env.ACTION_LOG_ID);
  if (
    !credentialId ||
    !ENTRA_PASSWORD_ID.test(credentialId) ||
    parsed.provider !== ENTRA_PROVIDER ||
    directory.provider !== ENTRA_PROVIDER ||
    parsed.vault_item_id !== credentialId ||
    parsed.vault_field !== PASSWORD_FIELD ||
    !isRequestId(parsed.request_id) ||
    !actionLogId ||
    !ACTION_LOG_ID.test(actionLogId) ||
    !allowedOperations.includes(operation) ||
    !accountUpn ||
    !EMAIL.test(accountUpn) ||
    (accountEmail !== undefined && !EMAIL.test(accountEmail)) ||
    !tenantId ||
    !LOWER_UUID.test(tenantId) ||
    parsed.secret_source_origin !== SIGN_IN_ORIGIN ||
    !principalObjectId ||
    !LOWER_UUID.test(principalObjectId)
  ) {
    throw new Error(
      'Entra password operation is outside its exact Skarbiec contract',
    );
  }
  return {
    credentialId,
    operation,
    accountUpn,
    accountEmail,
    tenantId,
    principalObjectId,
    skarbiecTenantId: stated(parsed.weles_tenant_id),
    requestId: parsed.request_id,
    actionLogId,
  };
}

/** A non-empty string, or undefined. */
function stated(value) {
  return typeof value === 'string' && value ? value : undefined;
}

/** A non-empty string trimmed and in lower case, or undefined. */
function lowered(value) {
  return stated(value)?.trim().toLowerCase();
}

function accountMatchesContract(account, contract) {
  const metadata = account?.metadata;
  const email = lowered(metadata?.email) ?? lowered(account?.username);
  const emailMatches =
    email === contract.accountUpn ||
    (contract.accountEmail !== undefined && email === contract.accountEmail);
  return (
    lowered(metadata?.entra_upn) === contract.accountUpn &&
    emailMatches &&
    lowered(metadata?.entra_tenant_id) === contract.tenantId &&
    lowered(metadata?.entra_principal_object_id) ===
      contract.principalObjectId &&
    metadata?.skarbiec_credential_id === contract.credentialId &&
    stated(metadata?.skarbiec_tenant_id) === contract.skarbiecTenantId
  );
}

export function updateAccountReference(account, contract) {
  if (!account.id) throw new Error('Entra account has no stable Skarbiec id');
  const metadata = {
    ...account.metadata,
    skarbiec_credential_id: contract.credentialId,
    entra_upn: contract.accountUpn,
    entra_tenant_id: contract.tenantId,
    entra_principal_object_id: contract.principalObjectId,
  };
  delete metadata.password;
  if (contract.skarbiecTenantId)
    metadata.skarbiec_tenant_id = contract.skarbiecTenantId;
  else delete metadata.skarbiec_tenant_id;
  if (!updateAccount(account.id, { metadata })) {
    throw new Error('Entra account credential-reference update failed');
  }
}

export async function openSession(account, label) {
  const { proxyUrl, persona } = await resolveAccountSession(account);
  const session = await WSession.start({ label, proxy: proxyUrl, persona });
  return { session, proxyUrl };
}

export async function queuedAccount(contract) {
  const account = await getSocialAccount('microsoft');
  if (!account || !accountMatchesContract(account, contract)) {
    return null;
  }
  return account;
}
