// The two directory surfaces that hold an Entra password: the change form that
// needs the current value and the self-service reset that does not, together
// with the compensating restore of the previous value and what that restore
// leaves the provider in.
//
// A screen the vision model could not judge never counts as a screen that
// confirmed or refused anything: it answers 'unavailable' where nothing was
// submitted yet, and 'ambiguous' where a password had already been sent. The
// forms are read by their own password fields: the new password and its
// confirmation are the last two, and the change form's current password
// comes before them.

import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';

import { fill, signIn } from './authorized_session.mjs';
import {
  appears,
  IDENTITY_CHALLENGE,
  judged,
  visible,
} from './sign_in/surfaces.mjs';
import { assertEntraIdentity } from './proven_identity.mjs';
import { CHANGE_PASSWORD_URL, SELF_SERVICE_RESET_URL } from './queued_job.mjs';

const CHANGE_CONFIRMED =
  'Does the page confirm the password was changed or reset?';
const CHANGE_REJECTED =
  'Does the page say the password was not changed (a wrong current password, a password that does not meet the rules, or an error)?';

/** The form's password fields: the new one and its confirmation (the last two) and any before them. */
async function passwordFields(page) {
  const before = await page.locator('input[type="password"]').all();
  const confirm = before.pop();
  const next = before.pop();
  return { before, next, confirm };
}

/** Submits the form and answers what the page says of it. */
async function submitAndJudge(page) {
  await humanClickLocator(page, page.locator('input[type="submit"], button[type="submit"]').first());
  await pageSettled(page);
  const confirmed = await judged(page, CHANGE_CONFIRMED);
  if (!confirmed.ok) return 'ambiguous';
  if (confirmed.shows) return 'changed';
  const refused = await judged(page, CHANGE_REJECTED);
  if (!refused.ok) return 'ambiguous';
  if (refused.shows) return 'rejected';
  return (await visible(page.locator('input[type="password"]'))) ? 'rejected' : 'ambiguous';
}

// 'changed' | 'rejected' | 'ambiguous' | 'challenged' | 'unavailable'
export async function changeEntraPassword(session, currentPassword, nextPassword) {
  const page = session.page;
  await page.goto(CHANGE_PASSWORD_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const challenged = await judged(page, IDENTITY_CHALLENGE);
  if (!challenged.ok) return 'unavailable';
  if (challenged.shows) return 'challenged';
  if (!(await appears(page.locator('input[type="password"]').first()))) return 'unavailable';
  const { before, next, confirm } = await passwordFields(page);
  const [current] = before;
  if (!current || !next || !confirm) return 'unavailable';
  await fill(page, current, currentPassword);
  await fill(page, next, nextPassword);
  await fill(page, confirm, nextPassword);
  return submitAndJudge(page);
}

// 'none' | 'completed' | 'failed' | 'unknown'
//
// 'failed' is the known-state refusal: the restore never changed the directory
// (refused, or never submitted), so it still holds the value this run wrote. A
// restore whose outcome is ambiguous, and everything after it left unproven,
// is 'unknown'.
export async function rollbackEntraPassword(session, contract, changedPassword, previousPassword, sink) {
  const signedIn = await signIn(session, contract, changedPassword);
  if (signedIn.verdict !== 'authenticated') return 'unknown';
  const identity = await assertEntraIdentity(session, contract, sink);
  if (!identity.ok) return 'unknown';
  const restored = await changeEntraPassword(session, changedPassword, previousPassword);
  if (restored === 'ambiguous') return 'unknown';
  if (restored !== 'changed') return 'failed';
  const reauthenticated = await signIn(session, contract, previousPassword);
  if (reauthenticated.verdict !== 'authenticated') return 'unknown';
  const restoredIdentity = await assertEntraIdentity(session, contract, sink);
  return restoredIdentity.ok ? 'completed' : 'unknown';
}

// A rollback that restored the previous value leaves the provider untouched, a
// refused rollback leaves the value this run wrote, and anything else leaves the
// directory password unknown.
export function providerEffectAfterRollback(rollbackStatus) {
  if (rollbackStatus === 'completed') return 'none';
  if (rollbackStatus === 'failed') return 'changed';
  return 'unknown';
}

// 'password_form' | 'identity_verification_required' | 'not_eligible' | 'unavailable'
export async function openSelfServiceReset(session, contract) {
  const page = session.page;
  await session.ctx.clearCookies();
  await page.goto(SELF_SERVICE_RESET_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const userInput = page
    .locator('input#userNameInput, input[name="UserName"], input[type="email"], input[type="text"]')
    .first();
  if ((await appears(userInput)) && (await visible(userInput))) {
    await fill(page, userInput, contract.accountUpn);
    await userInput.press('Enter');
    await pageSettled(page);
  }
  const ineligible = await judged(
    page,
    'Does the page say this account cannot reset its password here (account not found, or the administrator must be contacted)?',
  );
  if (!ineligible.ok) return 'unavailable';
  if (ineligible.shows) return 'not_eligible';
  const verification = await judged(
    page,
    'Does the page ask for a verification step before the password can be reset (a code, a phone, an alternate email, an authenticator, or characters from a picture)?',
  );
  if (!verification.ok) return 'unavailable';
  if (verification.shows) return 'identity_verification_required';
  const captcha = page.locator('iframe[src*="recaptcha"], iframe[title*="captcha" i], #wCaptchaDiv').first();
  if (await visible(captcha)) return 'identity_verification_required';
  const { next, confirm } = await passwordFields(page);
  return next && confirm ? 'password_form' : 'unavailable';
}

export async function submitResetPasswordForm(session, nextPassword) {
  const page = session.page;
  const { next, confirm } = await passwordFields(page);
  if (!next || !confirm) return 'unavailable';
  await fill(page, next, nextPassword);
  await fill(page, confirm, nextPassword);
  return submitAndJudge(page);
}
