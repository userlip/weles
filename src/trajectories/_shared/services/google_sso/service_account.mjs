// The service account behind a Google-SSO balance run: which stored identity
// signs in, and what balance the dashboard shows.
//
// Both answers are refusable. An identity that does not match the account the
// caller asked for is an error, not a substitution; a page that shows no
// balance returns nothing rather than the first price it happened to show.
import { readScopedLogin } from '../../../../_shared/scoped-secrets.mjs';
import { shownAmount } from '../../page/judged/seen.mjs';
import {
  findWelesRecordId,
  updateWelesRecord,
} from '../../skarbiec/accounts.mjs';

// The account's balance or remaining credit as the vision model reads the
// dashboard, in whatever words and language it labels it; a service price is
// not a balance, and a page showing none answers null.
export function readShownBalance(page) {
  return shownAmount(
    page,
    "account balance, wallet funds or remaining credit (not a plan's price)",
  );
}

// Resolve the shared Google SSO identity through its exact Skarbiec consumer.
// Callers for Ads, Gmail, Drive, and Workspace admin use their own service
// identities instead of reusing this grant.
export async function getGoogleSsoCreds(email) {
  const login = readScopedLogin('googleSso');
  if (email && login.email.toLowerCase() !== String(email).toLowerCase()) {
    throw new Error(
      'scoped Google SSO identity does not match the requested account',
    );
  }
  return login;
}
export async function getScopedGoogleLogin(serviceName) {
  return readScopedLogin(serviceName);
}

export async function patchServiceBalance(displayName, balance) {
  const id = findWelesRecordId(
    (document) =>
      document.context?.owner === 'weles' &&
      String(document.context?.display_name ?? '').toLowerCase() ===
        String(displayName).toLowerCase(),
  );
  if (!id) return false;
  const now = new Date().toISOString();
  return updateWelesRecord(id, {
    balance_usd: balance,
    last_balance_check: now,
    updated_at: now,
  });
}
