// The Apple ID sign-in inside Apple's idmsa frame, each secret typed under its
// one-use capability: the email, the password (past the passkey choice when
// Apple offers one), exactly one submitted attempt, and the 2FA code Stado
// relays from the account holder's session. Apple's refusal is named; a second
// attempt is never made, because each spends one of the few Apple allows.
import { STATUS_CODES } from 'node:http';
import { withCapability } from '../../../../dist/utils/capability.js';
import { relayAppleChallenge } from '../../../auth/apple-account-placement.mjs';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { completeAppleTwoFactorChallenge, TWO_FACTOR_FIELD } from './two_factor.mjs';

const SIGN_IN_COMPLETE = '/appleauth/auth/signin/complete';
// The answers to signin/complete that refuse the credentials, as HTTP names them.
const statusNamed = (name) => Number(Object.keys(STATUS_CODES).find((code) => STATUS_CODES[code] === name));
const REFUSING = new Set([statusNamed('Unauthorized'), statusNamed('Forbidden')]);

const typed = (guardId, capability, resource, type) =>
  withCapability(capability, { purpose: 'weles.browser.fill', resource, authorization_id: guardId }, type);

async function authFrame(page) {
  const handle = await page.waitForSelector('iframe[src*="idmsa.apple.com"]');
  const frame = await handle.contentFrame();
  if (!frame) throw new Error('APPLE_AUTH_FRAME_UNREACHABLE: the idmsa sign-in frame has no document');
  return frame;
}

/** Email, then the password field (past the passkey choice), each under its capability; their typed lengths. */
async function typeCredentials(page, frame, { capabilities, guardId }) {
  const email = frame.locator('#account_name_text_field');
  await email.waitFor({ state: 'visible' });
  const emailLength = await typed(guardId, capabilities.email, 'origin:https://idmsa.apple.com/email', async (value) => {
    await email.focus();
    await email.pressSequentially(value);
    // The Continue control stays disabled until Apple validates the field
    // from keystrokes; Enter advances the form.
    await email.press('Enter');
    return value.length;
  });
  await pageSettled(page);
  const password = frame.locator('#password_text_field, input[type="password"]').first();
  if (!(await password.isVisible())) {
    const choice = frame.locator('#continue-password');
    await ((await choice.isVisible()) ? choice : frame.locator('#sign-in')).click();
    await pageSettled(page);
  }
  if (!(await password.isVisible()))
    throw new Error(`APPLE_PASSWORD_FIELD_MISSING: Apple shows no password field after the email on ${page.url()}`);
  const passwordLength = await typed(guardId, capabilities.password, 'origin:https://idmsa.apple.com/password', async (value) => {
    await password.focus();
    await password.pressSequentially(value);
    await password.evaluate((input) => {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
    });
    return value.length;
  });
  const held = { email: await email.evaluate((el) => el.value.length), password: await password.evaluate((el) => el.value.length) };
  if (held.email !== emailLength || held.password !== passwordLength)
    throw new Error('APPLE_CREDENTIAL_LENGTH_MISMATCH: the sign-in form does not hold what was typed');
}

/** Whichever comes first: arrival, the 2FA prompt, a refusing status, or Apple marking its field invalid. */
function postPasswordState(page, frame, arrived, refusedStatus) {
  return Promise.any([
    page.waitForURL((url) => arrived(new URL(url))).then(() => 'arrived'),
    frame.locator(TWO_FACTOR_FIELD).first().waitFor({ state: 'visible' }).then(() => 'two_factor'),
    refusedStatus.then((status) => `refused with HTTP ${status}`),
    frame.locator('[aria-invalid="true"]').first().waitFor({ state: 'visible' }).then(() => 'refused on the form'),
  ]);
}

/**
 * Signs the guarded Apple ID in and waits until `arrived(url)` holds for the
 * page. Answers the 2FA relay's receipt when Apple asked for a code.
 */
export async function signInGuarded(s, guard, arrived, logPrefix) {
  const frame = await authFrame(s.page);
  await typeCredentials(s.page, frame, guard);
  await frame.waitForFunction(() => {
    const button = document.querySelector('#sign-in');
    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
  });
  // Attached before the click: only the status is kept, nothing that could
  // carry the credential into a log.
  const refusedStatus = s.page
    .waitForResponse((response) => response.url().includes(SIGN_IN_COMPLETE) && REFUSING.has(response.status()))
    .then((response) => response.status());
  // Playwright's actionability click hangs on Apple's Angular-bound control;
  // the validated form is submitted with a DOM click.
  await frame.locator('#sign-in').evaluate((button) => button.click());
  console.log(`${logPrefix} submitted exactly one authorized password attempt`);
  const state = await postPasswordState(s.page, frame, arrived, refusedStatus);
  if (state.startsWith('refused'))
    throw new Error(
      `APPLE_SIGN_IN_REFUSED: Apple ${state}: the secret the broker resolved for origin:https://idmsa.apple.com/password is not this account's current password, or the email is not this account's`,
    );
  if (state === 'arrived') return null;
  const relay = relayAppleChallenge(guard.identity, guard.guardId);
  const twoFactor = await completeAppleTwoFactorChallenge(
    s.page,
    frame,
    (consume) =>
      withCapability(
        guard.capabilities.two_factor.capability,
        { purpose: 'weles.apple.2fa', resource: `challenge:apple/${guard.guardId}`, authorization_id: guard.guardId },
        consume,
      ),
    logPrefix,
  );
  await s.page.waitForURL((url) => arrived(new URL(url)));
  return {
    authorization_id: guard.guardId,
    holder: relay.holder,
    user: relay.user,
    destination: relay.destination,
    source: twoFactor.source,
  };
}
