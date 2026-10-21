import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { readWelesManagedCredential } from '../../../dist/secrets/scoped-service.js';
import { WSession } from '../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { persistFreshCookieJar } from '../_shared/auth/cookie-freshness.mjs';
import { PASSWORD_FIELD } from './password_lifecycle/constants.mjs';
import { registrationPassword as generatedPassword } from '../../../dist/utils/identity/password.js';
import {
  accountMatchesContract,
  constraints,
} from './password_lifecycle/contract.mjs';
import { hasIdentityChallenge } from './password_lifecycle/sign_in_page.mjs';
import {
  changePassword,
  rollbackPassword,
  verifyPassword,
} from './password_lifecycle/operations.mjs';
import {
  commitRotatedPassword,
  writePasswordSecret,
} from './password_lifecycle/commit.mjs';
import { writeCredentialOperation } from '../../../dist/secrets/operation/answer.js';

/**
 * A step Microsoft holds behind a person's identity approval. This flow
 * carries no approval resource to resume from, so the operation ends here,
 * stated as failed with the reason, and the page is kept for review.
 */
function needsApproval(reason, page) {
  writeFileSync(
    join(runRecordingsDir(), 'pending_review.json'),
    JSON.stringify({ status: 'needs_human_approval', reason, url: page.url() }, null, ' '),
  );
  return writeCredentialOperation({
    status: 'operation_failed',
    code: 'MICROSOFT_IDENTITY_APPROVAL_REQUIRED',
    providerEffect: 'none',
    retryable: false,
    message: reason,
  });
}

/** The operation finished; `providerEffect` says whether Microsoft's password changed. */
function completed(providerEffect, message) {
  return writeCredentialOperation({
    status: 'operation_completed',
    providerEffect,
    message,
  });
}

/** The queued Microsoft account, which has to be the one the contract names. */
async function contractAccount(contract) {
  const account = await getSocialAccount('microsoft');
  if (!account || !accountMatchesContract(account, contract)) {
    throw new Error(
      'queued Microsoft account does not match the exact credential account',
    );
  }
  return account;
}

/** The managed password Skarbiec holds for the contract, or null when it holds none; a read Skarbiec refuses raises with its cause. */
function managedPassword(contract) {
  const password = readWelesManagedCredential(contract.credentialId, PASSWORD_FIELD, contract.tenantId);
  return password ? password : null;
}

async function openSession(account, label) {
  const { proxyUrl, persona } = await resolveAccountSession(account);
  const session = await WSession.start({ label, proxy: proxyUrl, persona });
  return { session, proxyUrl };
}

async function persistCookies(session, account, proxyUrl) {
  const cookies = await session.ctx.cookies();
  await persistFreshCookieJar(account, cookies, { currentProxyUrl: proxyUrl });
}

export async function verifyMicrosoftPassword() {
  const contract = constraints('verify');
  const account = await contractAccount(contract);
  const password = readWelesManagedCredential(
    contract.credentialId,
    PASSWORD_FIELD,
    contract.tenantId,
  );
  if (!password)
    throw new Error('managed Microsoft password is unavailable from Skarbiec');
  const { session, proxyUrl } = await openSession(
    account,
    'microsoft_verify_password',
  );
  try {
    if (!(await verifyPassword(session, contract.accountEmail, password))) {
      if (await hasIdentityChallenge(session.page)) {
        return needsApproval(
          'Microsoft requires interactive identity approval to verify the managed password',
          session.page,
        );
      }
      throw new Error('fresh Microsoft password authentication failed');
    }
    writePasswordSecret(contract, password, contract.operation);
    await persistCookies(session, account, proxyUrl);
    return completed(
      'none',
      'the managed Microsoft password signed in fresh and was kept',
    );
  } finally {
    await session.close();
  }
}

// adopt takes over a password the operator already knows. Skarbiec stages that
// candidate under the item, bound to this request id; this run reads the staged
// value through the scoped managed-credential reader and proves it with a fresh
// login. Skarbiec activates the staged revision itself on operation_completed
// and refuses every Weles write for an adopt, so this run writes nothing and
// never touches the value the provider holds.
export async function adoptMicrosoftPassword() {
  const contract = constraints('adopt');
  const account = await contractAccount(contract);
  const candidate = managedPassword(contract);
  if (!candidate)
    throw new Error(
      'staged Microsoft password candidate is unavailable from Skarbiec',
    );
  const { session, proxyUrl } = await openSession(
    account,
    'microsoft_adopt_password',
  );
  try {
    if (!(await verifyPassword(session, contract.accountEmail, candidate))) {
      if (await hasIdentityChallenge(session.page)) {
        return needsApproval(
          'Microsoft requires interactive identity approval before the staged password candidate can be adopted',
          session.page,
        );
      }
      throw new Error(
        'staged Microsoft password candidate failed a fresh Microsoft login',
      );
    }
    await persistCookies(session, account, proxyUrl);
    return completed(
      'none',
      'the staged Microsoft password signed in fresh and can be adopted',
    );
  } finally {
    await session.close();
  }
}

export async function rotateMicrosoftPassword() {
  const contract = constraints('rotate');
  const account = await contractAccount(contract);
  const currentPassword = managedPassword(contract);
  const nextPassword = generatedPassword();
  const { session, proxyUrl } = await openSession(
    account,
    'microsoft_reset_password',
  );
  try {
    const allowUnknownCurrentPasswordRecovery =
      process.env.MICROSOFT_ALLOW_UNKNOWN_CURRENT_PASSWORD_RECOVERY === '1';
    if (!currentPassword && !allowUnknownCurrentPasswordRecovery) {
      return needsApproval(
        'Microsoft password rotation requires one known current password for rollback safety',
        session.page,
      );
    }
    if (
      currentPassword &&
      !(await verifyPassword(
        session,
        contract.accountEmail,
        currentPassword,
      )) &&
      !allowUnknownCurrentPasswordRecovery
    ) {
      if (await hasIdentityChallenge(session.page)) {
        return needsApproval(
          'Microsoft requires interactive identity approval before password rotation',
          session.page,
        );
      }
      throw new Error('current Microsoft password failed before rotation');
    }
    const changeResult = await changePassword(
      session,
      contract.accountEmail,
      currentPassword,
      nextPassword,
    );
    if (changeResult === 'unavailable') {
      return needsApproval(
        'Microsoft requires interactive identity verification before password rotation',
        session.page,
      );
    }
    if (changeResult !== 'changed') {
      if (
        await verifyPassword(session, contract.accountEmail, currentPassword)
      ) {
        throw new Error(
          'Microsoft rejected the password change; the current password remains valid',
        );
      }
      if (await verifyPassword(session, contract.accountEmail, nextPassword)) {
        const rolledBack = await rollbackPassword(
          session,
          contract.accountEmail,
          nextPassword,
          currentPassword,
        );
        if (rolledBack)
          throw new Error(
            'Microsoft returned an ambiguous change response; provider password was rolled back',
          );
      }
      throw new Error(
        'Microsoft password change outcome is ambiguous and automatic rollback failed',
      );
    }
    if (!(await verifyPassword(session, contract.accountEmail, nextPassword))) {
      const rolledBack = await rollbackPassword(
        session,
        contract.accountEmail,
        nextPassword,
        currentPassword,
      );
      if (!rolledBack) {
        throw new Error(
          'fresh Microsoft login failed and compensating password rollback also failed',
        );
      }
      throw new Error(
        'fresh Microsoft login failed; provider password was rolled back',
      );
    }
    await commitRotatedPassword({
      contract,
      account,
      nextPassword,
      currentPassword,
      session,
    });
    await persistCookies(session, account, proxyUrl);
    return completed(
      'changed',
      'the Microsoft password was rotated, signed in fresh and committed to Skarbiec',
    );
  } finally {
    await session.close();
  }
}
