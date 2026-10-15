// Rotation: the operation that already knows the managed Entra password, so a
// compensating restore of the previous value exists at every step after the
// write.
//
// The phase order is the whole point. Sign in with the known value, assert
// tenant, principal object id and UPN against the token claims, write the new
// value, re-prove it with a fresh login, and only then commit to Skarbiec.
// Anything the directory left unproven is rolled back to the previous value, and
// what the rollback itself leaves unproven quarantines the item instead of
// retrying it.
//
// Moved out of entra_password_lifecycle.mjs, which keeps the three trajectory
// entry points.

import { commitPassword, outcome } from '../answer_and_custody.mjs';
import { commitAfterFreshLogin, signIn, skarbiecCommit } from '../authorized_session.mjs';
import {
  changeEntraPassword,
  providerEffectAfterRollback,
  rollbackEntraPassword,
} from '../directory_password.mjs';
import { assertEntraIdentity } from '../proven_identity.mjs';

export async function rotateDirectoryPassword(
  session,
  account,
  contract,
  plan,
) {
  const { currentPassword, nextPassword, sink, proxyUrl, evidence } = plan;
  const signedIn = await signIn(session, contract, currentPassword);
  const { verdict } = signedIn;
  evidence.push(`entra_sign_in:${verdict}`);
  if (verdict !== 'authenticated') {
    const challenged = verdict === 'identity_challenge';
    const rejected = verdict === 'rejected';
    const said = challenged
      ? 'Entra requires interactive identity approval before the password rotation'
      : rejected
        ? 'the managed Entra password was rejected at sign-in'
        : `the Entra password sign-in did not reach a password check (${verdict})`;
    return outcome(contract, {
      status: challenged ? 'needs_human_approval' : 'operation_failed',
      code: challenged
        ? 'ENTRA_SIGN_IN_REQUIRES_HUMAN_APPROVAL'
        : rejected
          ? 'ENTRA_CURRENT_PASSWORD_REJECTED'
          : 'ENTRA_SIGN_IN_SURFACE_UNAVAILABLE',
      phase: challenged ? 'identity_verification' : 'entra_sign_in',
      retryable: !rejected,
      providerEffect: 'none',
      rollbackStatus: 'none',
      reason: `${said}: ${signedIn.reason}`,
    });
  }
  const identity = await assertEntraIdentity(session, contract, sink);
  if (!identity.ok) {
    return outcome(contract, {
      status: 'operation_failed',
      code: identity.code,
      phase: 'identity_verification',
      retryable: identity.retryable,
      providerEffect: 'none',
      rollbackStatus: 'none',
      reason: identity.reason,
    });
  }
  evidence.push('identity_verification:confirmed');
  const changed = await changeEntraPassword(
    session,
    currentPassword,
    nextPassword,
  );
  evidence.push(`password_change:${changed}`);
  // The change answers that sent nothing to the directory, each with what it
  // means for the run.
  const notSubmitted = {
    challenged: {
      code: 'ENTRA_PASSWORD_CHANGE_REQUIRES_HUMAN_VERIFICATION',
      phase: 'identity_verification',
      retryable: false,
      reason:
        'the Entra password change surface asked for interactive identity verification',
    },
    unavailable: {
      code: 'ENTRA_PASSWORD_CHANGE_SURFACE_UNAVAILABLE',
      phase: 'password_change',
      retryable: true,
      reason:
        'the Entra password change surface did not present the current and new password fields',
    },
  };
  if (Object.hasOwn(notSubmitted, changed)) {
    return outcome(contract, {
      status: 'needs_human_approval',
      ...notSubmitted[changed],
      providerEffect: 'none',
      rollbackStatus: 'none',
    });
  }
  if (changed === 'rejected') {
    return outcome(contract, {
      status: 'operation_failed',
      code: 'ENTRA_PASSWORD_CHANGE_REJECTED',
      phase: 'password_change',
      retryable: true,
      providerEffect: 'none',
      rollbackStatus: 'none',
      reason: 'the Entra directory rejected the password change',
    });
  }
  if (changed === 'ambiguous') {
    const rollbackStatus = await rollbackEntraPassword(
      session,
      contract,
      nextPassword,
      currentPassword,
      sink,
    );
    evidence.push(`rollback:${rollbackStatus}`);
    return outcome(contract, {
      status: 'operation_failed',
      code: 'ENTRA_PASSWORD_CHANGE_AMBIGUOUS',
      phase: 'password_change',
      retryable: rollbackStatus === 'completed',
      providerEffect: providerEffectAfterRollback(rollbackStatus),
      rollbackStatus,
      reason: 'the Entra password change outcome could not be confirmed',
    });
  }
  const changedAt = new Date().toISOString();
  const rotation = await commitAfterFreshLogin(session, account, contract, {
    password: nextPassword,
    writeOperation: 'rotate',
    sink,
    proxyUrl,
    providerEffect: 'changed',
    evidence,
  });
  if (rotation.answer) {
    const rollbackStatus = await rollbackEntraPassword(
      session,
      contract,
      nextPassword,
      currentPassword,
      sink,
    );
    evidence.push(`rollback:${rollbackStatus}`);
    return outcome(contract, {
      ...rotation.answer,
      reason: rotation.answer.message,
      providerEffect: providerEffectAfterRollback(rollbackStatus),
      rollbackStatus,
    });
  }
  if (!rotation.committed) {
    const rollbackStatus = await rollbackEntraPassword(
      session,
      contract,
      nextPassword,
      currentPassword,
      sink,
    );
    evidence.push(`rollback:${rollbackStatus}`);
    if (rollbackStatus === 'completed') {
      const restoreFailure = await Promise.resolve()
        .then(() => commitPassword(contract, currentPassword, 'rollback'))
        .then(
          () => null,
          (error) => error.message,
        );
      return outcome(contract, {
        status: 'operation_failed',
        code: 'SKARBIEC_COMMIT_FAILED',
        phase: restoreFailure ? 'rollback' : 'skarbiec_commit',
        retryable: !restoreFailure,
        providerEffect: 'none',
        rollbackStatus: restoreFailure ? 'failed' : 'completed',
        reason: restoreFailure
          ? `the Skarbiec commit failed (${rotation.commitFailure}), Entra was restored, and the Skarbiec restore failed (${restoreFailure})`
          : `the Skarbiec commit failed (${rotation.commitFailure}) and both Entra and Skarbiec were restored to the previous password`,
      });
    }
    if (rollbackStatus === 'unknown') {
      // Nothing proves which value the directory now holds, so the item is
      // quarantined instead of being written to or retried.
      return outcome(contract, {
        status: 'operation_failed',
        code: 'SKARBIEC_COMMIT_FAILED',
        phase: 'rollback',
        retryable: false,
        providerEffect: 'unknown',
        rollbackStatus,
        reason: `the Skarbiec commit failed (${rotation.commitFailure}) and the compensating Entra rollback left the directory password unproven`,
      });
    }
    // The directory refused the rollback and still holds the value this run
    // proved by a fresh login, so the only consistent recovery is to land that
    // value in Skarbiec.
    const secondFailure = await skarbiecCommit(account, contract, nextPassword, 'rotate');
    if (secondFailure) {
      return outcome(contract, {
        status: 'operation_failed',
        code: 'SKARBIEC_COMMIT_FAILED',
        phase: 'skarbiec_commit',
        retryable: false,
        providerEffect: 'changed',
        rollbackStatus,
        reason: `the Skarbiec commit failed (${rotation.commitFailure}), the compensating Entra rollback failed, and the second commit failed (${secondFailure})`,
      });
    }
    evidence.push('skarbiec_commit:rotate');
    return outcome(contract, {
      status: 'operation_completed',
      providerEffect: 'changed',
      rollbackStatus,
      changedAt,
      evidence,
      reason:
        'the Entra password was rotated and committed to Skarbiec on the second commit attempt',
    });
  }
  return outcome(contract, {
    status: 'operation_completed',
    providerEffect: 'changed',
    rollbackStatus: 'none',
    changedAt,
    evidence,
    reason:
      'the Entra password was rotated, re-authenticated, and committed to Skarbiec',
  });
}
