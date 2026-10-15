/**
 * The signup form itself: credentials typed and submitted, the name step, the
 * createAccount call and whatever LinkedIn answers it with, then the wait for an
 * authenticated session, the e-mail code, the onboarding gate, the saved account
 * and the character bind. A challenge here ends the run — it is never solved.
 */
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { fieldCodeLength, mailedCode } from '../../_shared/inputs/mailed_code.mjs';
import {
  assertLinkedinAuthenticatedRegistration,
  assertLinkedinProxyStable,
  assertNoLinkedinChallengePage,
} from '../../_shared/linkedin/signup/register_guard.mjs';
import { fillPostRegisterOnboarding } from '../../_shared/linkedin/onboarding/work_school.mjs';
import { ONBOARDING_PROFILE } from './run_request.mjs';
import { confirmLinkedinEmail } from '../../_shared/linkedin/checkpoint.mjs';
import { autoBindCharacter } from '../../lib/character-bind.mjs';
import { submitEmailAndPassword, submitNames } from './account_creation/form_steps.mjs';

// LinkedIn sends a new member to these routes when it wants the emailed PIN;
// anywhere else is the signed-in redirect.
const EMAIL_PIN_ROUTES = ['/checkpoint', '/verify', '/email-verification', '/email_verification'];

// saveAccount throws when the account could not be saved; the refusal
// classifier names that failure by this prefix.
async function saveVerifiedLinkedinAccount(session, account) {
  try {
    return await session.saveAccount('linkedin', account);
  } catch (error) {
    throw new Error(`ACCOUNT_PERSIST_FAILED: ${error.message}`, { cause: error });
  }
}

async function settleAuthenticatedSession({ session, identity, recordStage, proxyWatch }) {
  // The createAccount answer was awaited before this step; LinkedIn's
  // redirect after it (to /feed, /onboarding, /checkpoint, or back to /signup
  // on a silent rejection) has happened once the page has settled.
  await pageSettled(session.page);
  const verifyUrl = session.page.url();
  recordStage('post_name_url', { verify_url: verifyUrl });
  proxyWatch.expectedExitIp = await assertLinkedinProxyStable(
    session,
    'before_success_validation',
    proxyWatch.expectedExitIp,
  );
  recordStage('proxy_stable_before_success_validation');
  // /signup is not success: a silent reCAPTCHA-score rejection looks identical.
  const verifyPath = new URL(verifyUrl).pathname;
  if (/^\/signup\/?$/.test(verifyPath) || verifyPath.includes('/signup/api/'))
    throw new Error(
      `signup_did_not_complete: URL stayed at ${verifyUrl} — LinkedIn did not accept the registration`,
    );
  if (!EMAIL_PIN_ROUTES.some((route) => verifyPath.includes(route))) {
    const redirected = await assertLinkedinAuthenticatedRegistration(session, 'after_registration_redirect');
    recordStage('registration_redirect_authenticated', { authenticated: redirected.has_li_at });
    return redirected;
  }
  const pinIn = session.page
    .locator('input[name="pin"], input[autocomplete="one-time-code"], input#input__email_verification_pin')
    .filter({ visible: true })
    .first();
  await pinIn.waitFor({ state: 'visible' });
  // The PIN field states how many digits the mailed PIN has.
  const code = await mailedCode(identity.email, 'linkedin', await fieldCodeLength(pinIn));
  await humanClickLocator(session.page, pinIn);
  await humanType(session.page, code);
  await humanClickLocator(
    session.page,
    session.page.locator('button#email-pin-submit-button, button[type="submit"]').first(),
  );
  // The PIN form posts and LinkedIn moves the page off the verification step,
  // or keeps it there with its own message; the settled page answers which.
  await pageSettled(session.page);
  const verified = await assertLinkedinAuthenticatedRegistration(session, 'after_email_verification');
  recordStage('email_verification_completed', { authenticated: verified.has_li_at });
  return verified;
}

export async function createLinkedinAccount(ctx) {
  const { session, identity, recordStage, proxyWatch } = ctx;
  await submitEmailAndPassword(ctx);
  await submitNames(ctx);
  await settleAuthenticatedSession(ctx);
  // The "add a role/school" onboarding gate, filled so the account can view
  // other profiles; what it filled is part of the run's record.
  recordStage('onboarding', await fillPostRegisterOnboarding(session.page, ONBOARDING_PROFILE));
  await assertNoLinkedinChallengePage(session, 'after_onboarding');
  recordStage('no_challenge_after_onboarding');
  const authState = await assertLinkedinAuthenticatedRegistration(session, 'after_onboarding');
  recordStage('after_onboarding_authenticated', { authenticated: authState.has_li_at });
  proxyWatch.expectedExitIp = await assertLinkedinProxyStable(
    session,
    'before_account_persist',
    proxyWatch.expectedExitIp,
  );
  recordStage('proxy_stable_before_account_persist');
  await saveVerifiedLinkedinAccount(session, {
    username: identity.handle,
    email: identity.email,
    password: identity.password,
    name: `${identity.first} ${identity.last}`,
  });
  recordStage('account_persisted');
  // The confirmation's answer (found and opened, or why not) and the bind's
  // are part of the run's record; a navigation that fails fails the run.
  recordStage('email_confirmation', await confirmLinkedinEmail(session.page, identity.email));
  recordStage('character_bound', await autoBindCharacter(identity.handle, 'linkedin'));
  return authState;
}
