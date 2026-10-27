// The signup form's two submits: the email and password, then the names and
// the createAccount call. A captcha or a createAccount challenge ends the run
// with what was read of it; it is never solved.
import { humanFill } from '../../../../../dist/human/keyboard.js';
import { humanScrollPage } from '../../../../../dist/human/mouse.js';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import {
  assertLinkedinProxyStable,
  assertNoLinkedinChallengePage,
  ensureLinkedinSignupForm,
} from '../../../_shared/linkedin/signup/register_guard.mjs';
import { collectSubmitState, writeSubmitDiagnostics } from '../diagnostics.mjs';
import {
  hasVisibleCaptchaChallenge,
  inspectCreateAccountChallenge,
} from '../refusal.mjs';
import { recordSubmitFailure, submitObserved } from './submit_observed.mjs';

const SIGNUP_API = /\/signup\/api\//;
const CREATE_ACCOUNT_API = /\/signup\/api\/cors\/createAccount/;

const messageOf = (value) =>
  value instanceof Error ? value.message : String(value);

export async function submitEmailAndPassword({
  session,
  identity,
  recordStage,
  proxyWatch,
}) {
  const { emailLoc, pwdLoc } = await ensureLinkedinSignupForm(session);
  recordStage('signup_form_ready');
  // A person reads the signup form before typing into it.
  await humanScrollPage(session.page, 'down');
  await pageSettled(session.page);
  await humanFill(session.page, emailLoc, identity.email);
  await pageSettled(session.page);
  await humanFill(session.page, pwdLoc, identity.password);
  await pageSettled(session.page);
  recordStage('email_password_filled');
  proxyWatch.expectedExitIp = await assertLinkedinProxyStable(
    session,
    'before_submit_email_password',
    proxyWatch.expectedExitIp,
  );
  recordStage('proxy_stable_before_email_password_submit');

  const { diagnostics } = await submitObserved(
    { session, recordStage },
    {
      button: session.page
        .locator(
          'button#join-form-submit, button[data-tracking-control-name*="signup"]',
        )
        .first(),
      pattern: SIGNUP_API,
      stage: 'email_password_submitted',
      afterStage: 'after_submit_email_password',
      label: 'submit1_diagnostics',
      before: await collectSubmitState(
        session.page,
        'before_submit_email_password',
      ),
    },
  );
  await writeSubmitDiagnostics('submit1_diagnostics', diagnostics);
  console.log(
    `[register] submit1 ${JSON.stringify({ method: diagnostics.request?.method, status: diagnostics.response?.status, url: diagnostics.response?.url })}`,
  );
  await assertNoLinkedinChallengePage(session, 'after_submit_email_password');
  recordStage('no_challenge_after_email_password_submit');

  const hasV2 = await hasVisibleCaptchaChallenge(session.page);
  recordStage('captcha_frame_probe', { has_visible_captcha_frame: hasV2 });
  if (hasV2)
    throw new Error(
      'DETECTION_TRIGGERED: visible CAPTCHA challenge after email/password submit',
    );
}

// A createAccount challenge means the run is burned: solving it is not
// attempted. The challenge page is classified and recorded, and the run fails
// so the close-time fingerprint and detection report are written.
async function refuseCreateAccountChallenge(
  { session, recordStage },
  challengeUrl,
) {
  let challenge;
  try {
    challenge = await inspectCreateAccountChallenge(session, challengeUrl);
  } catch (inspectError) {
    recordStage('create_account_challenge_not_classified', {
      error: messageOf(inspectError),
    });
    throw new Error(
      `DETECTION_TRIGGERED: createAccount challengeUrl detected, and the challenge page itself could not be read: ${messageOf(inspectError)}`,
      { cause: inspectError },
    );
  }
  recordStage('create_account_challenge_classified', {
    challenge_kind: challenge.kind,
    challenge_title: challenge.title,
    challenge_url: challenge.challenge_url,
  });
  throw new Error(
    `DETECTION_TRIGGERED: createAccount challengeUrl detected (kind=${challenge.kind})`,
  );
}

export async function submitNames({
  session,
  identity,
  recordStage,
  proxyWatch,
}) {
  const firstLoc = session.page
    .locator('input[name="first-name"], input#first-name')
    .filter({ visible: true })
    .first();
  const lastLoc = session.page
    .locator('input[name="last-name"], input#last-name')
    .filter({ visible: true })
    .first();
  const hasFirst = Boolean(await firstLoc.count());
  const hasLast = Boolean(await lastLoc.count());
  if (!(hasFirst && hasLast)) {
    recordStage('first_last_skipped', {
      has_first_input: hasFirst,
      has_last_input: hasLast,
      url: session.page.url(),
    });
    return;
  }
  await humanFill(session.page, firstLoc, identity.first);
  await pageSettled(session.page);
  await humanFill(session.page, lastLoc, identity.last);
  await pageSettled(session.page);
  recordStage('first_last_filled');
  proxyWatch.expectedExitIp = await assertLinkedinProxyStable(
    session,
    'before_create_account',
    proxyWatch.expectedExitIp,
  );
  recordStage('proxy_stable_before_create_account');
  // On a challenged session createAccount answers HTTP 200 with
  // {submissionId, challengeUrl:"/checkpoint/challengeIframe/..."}: the
  // challenge lives in an iframe at challengeUrl, not in a redirect, so the
  // answer is read rather than the page.
  const { response, text, diagnostics } = await submitObserved(
    { session, recordStage },
    {
      button: session.page
        .locator('button#join-form-submit, button[type="submit"]')
        .first(),
      pattern: CREATE_ACCOUNT_API,
      stage: 'create_account_submitted',
      afterStage: 'after_create_account',
      label: 'submit2_diagnostics',
      before: await collectSubmitState(session.page, 'before_create_account'),
    },
  );
  const status = response.status();
  let body;
  try {
    body = JSON.parse(text);
  } catch (cause) {
    const error = Object.assign(
      new Error('LinkedIn createAccount response is not valid JSON', { cause }),
      {
        code: 'LINKEDIN_CREATE_ACCOUNT_RESPONSE_INVALID',
        requestMethod: response.request().method(),
        requestUrl: response.url(),
        status,
        pageUrl: session.page.url(),
      },
    );
    await recordSubmitFailure('submit2_diagnostics', diagnostics, error);
    throw error;
  }
  const isObject = body !== null && typeof body === 'object';
  const challengeUrl = isObject ? body.challengeUrl : undefined;
  diagnostics.create_account = {
    status,
    has_challenge_url: Boolean(challengeUrl),
    challenge_url: challengeUrl,
    body_keys: isObject ? Object.keys(body) : undefined,
  };
  await writeSubmitDiagnostics('submit2_diagnostics', diagnostics);
  console.log(
    `[register] createAccount ${JSON.stringify({ status, submissionId: isObject ? body.submissionId : undefined, challengeUrl })}`,
  );
  recordStage('create_account_response', {
    status,
    has_challenge_url: Boolean(challengeUrl),
  });
  if (challengeUrl)
    await refuseCreateAccountChallenge({ session, recordStage }, challengeUrl);
  await pageSettled(session.page);
  await assertNoLinkedinChallengePage(session, 'after_create_account');
  recordStage('no_challenge_after_create_account');
}
