// The Skarbiec Google login a Google account action works on, and the
// parameter shapes of the actions that act on one (account security, app
// passwords). Every refusal names what the caller must state.

import { itemPlayingRole } from '../../state/skarbiec-records.js';

/**
 * The Skarbiec login a Google account action works on. An operator asks by
 * role (`login_role`, the item carrying stado:role:<role>); a caller that
 * found the item at run time in a vault listing — Stado's seed enrolment
 * walks every login — passes the id it found (`login_item`). Exactly one of
 * the two. `accepted`, when given, is the whole set of keys the action takes.
 */
export function googleLogin(
  params: Record<string, unknown>,
  accepted?: string[],
): string {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error(
      'login_role or login_item must name the Skarbiec Google login',
    );
  }
  if (accepted && Object.keys(params).some((key) => !accepted.includes(key))) {
    throw new Error(`this action accepts only ${accepted.join(' or ')}`);
  }
  const role = params.login_role;
  const item = params.login_item;
  if ((role === undefined) === (item === undefined)) {
    throw new Error('provide exactly one of login_role or login_item');
  }
  if (typeof role === 'string' && role.trim())
    return itemPlayingRole(role.trim());
  if (typeof item === 'string' && item.trim()) return item.trim();
  throw new Error('login_role or login_item must be a nonempty string');
}

export function validateAccountSecurityParams(
  params: Record<string, unknown>,
): string {
  return googleLogin(params, ['login_role', 'login_item']);
}

/**
 * An app password ends in Skrzynka, which files the mailbox under one
 * organization; the caller names it, nothing is assumed.
 */
export function validateAppPasswordParams(params: Record<string, unknown>): {
  loginItem: string;
  organization: string;
  expectedAccount: string;
} {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error(
      'app-password params must declare the login, organization and expected_account',
    );
  }
  const { organization, expected_account: expectedAccount, ...login } = params;
  if (typeof organization !== 'string' || !organization.trim()) {
    throw new Error(
      'organization must name the Skrzynka organization the mailbox is declared in',
    );
  }
  if (typeof expectedAccount !== 'string' || !expectedAccount.trim()) {
    throw new Error(
      'expected_account must name the Gmail account the mailbox belongs to',
    );
  }
  return {
    loginItem: googleLogin(login, ['login_role', 'login_item']),
    organization: organization.trim(),
    expectedAccount: expectedAccount.trim(),
  };
}
