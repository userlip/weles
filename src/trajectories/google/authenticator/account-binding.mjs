import {
  readDocument,
  writeUnchangedDocument,
} from '../../../../dist/state/skarbiec-records.js';

export function validateExpectedAccount(login, expected) {
  if (expected === undefined) return;
  if (typeof expected !== 'string' || !expected.trim()) {
    throw Object.assign(
      new Error(
        'WELES_EXPECTED_ACCOUNT must name the requested Google account when supplied',
      ),
      { code: 'expected_account_required' },
    );
  }
  if (login.email.trim().toLowerCase() !== expected.trim().toLowerCase()) {
    throw Object.assign(
      new Error(
        `Selected login ${login.loginItem} belongs to ${login.email}, not requested account ${expected.trim()}`,
      ),
      { code: 'expected_account_mismatch' },
    );
  }
}

/** The outcome when Google accepted the enrollment but Skarbiec did not
 * confirm the seed it was given, with the cause. */
function seedUnconfirmed(login, cause) {
  return {
    ok: false,
    blocked: 'seed_persist_unconfirmed',
    provider_enrollment_confirmed: true,
    seed_written: null,
    detail: `Google accepted enrollment for ${login.email}, but conditional seed persistence for ${login.loginItem} was not confirmed: ${cause}`,
  };
}

export function persistEnrolledSeed(login, secret) {
  const payload = {
    ...login.document,
    fields: { ...login.document.fields, totp_secret: secret },
  };
  let stored;
  try {
    writeUnchangedDocument(login.loginItem, login.document, payload);
    stored = readDocument(login.loginItem);
  } catch (error) {
    return seedUnconfirmed(login, error.message);
  }
  if (
    typeof stored.fields?.username !== 'string' ||
    stored.fields.username.trim().toLowerCase() !==
      login.email.trim().toLowerCase() ||
    stored.fields.totp_secret !== secret
  ) {
    return seedUnconfirmed(
      login,
      'Skarbiec readback did not confirm the enrolled account and seed',
    );
  }
  return { ok: true };
}
