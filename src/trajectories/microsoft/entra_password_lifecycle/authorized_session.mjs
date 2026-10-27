// How a signed-in Entra session comes about on the converged Microsoft screens,
// and what happens the moment a fresh login has proven something: the reads and
// fills those screens need, the sign-in walk itself, and the Skarbiec commit
// that only an asserted identity is allowed to reach.
//
// Reading a screen and waiting for a control are evidence here, not decoration.
// The screens are read by the vision model (`sign_in/surfaces.mjs`), and a
// judgement it could not give is an answer of its own carrying the reason, so
// each caller branches on that instead of on a screen that seemed to say nothing.
// Every step waits on the page itself, never on a pause.

import { humanFill } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';

import { persistFreshCookieJar } from '../../_shared/auth/cookie-freshness.mjs';
import { commitPassword, outcome } from './answer_and_custody.mjs';
import { assertEntraIdentity } from './proven_identity.mjs';
import {
  answerStaySignedIn,
  appears,
  choosePasswordSignIn,
  IDENTITY_CHALLENGE,
  judged,
  visible,
} from './sign_in/surfaces.mjs';
import {
  AUTHORIZED_CONTEXT_HOST,
  AUTHORIZED_CONTEXT_URL,
  AUTHORIZED_CONTEXT_URL_PATTERN,
  updateAccountReference,
} from './queued_job.mjs';

const SUBMIT = 'input[type="submit"]#idSIButton9, button[type="submit"]';

export async function fill(page, locator, value) {
  await locator.waitFor({ state: 'visible' });
  await humanFill(page, locator, value);
}

// The converged control re-renders during hydration and can silently drop
// keystrokes of a human-typed value — sometimes after an immediate readback
// already looked right — so every fill settles and reads back before the form
// moves on. A readback that disagreed leaves the form's own verdict to
// decide; a readback that never reached the control at all proves nothing
// about the typed value and is raised with its cause.
async function fillVerified(page, locator, value) {
  await fill(page, locator, value);
  await pageSettled(page);
  await locator.inputValue().catch((error) => {
    throw new Error(
      `a typed sign-in value could not be verified: the control value could not be read back: ${error.message}`,
      {
        cause: error,
      },
    );
  });
}

/**
 * Write the proven password to Skarbiec and point the account at it. Answers
 * null once both are written, else the cause the write or the update failed
 * with, for the caller's outcome.
 */
export function skarbiecCommit(account, contract, password, writeOperation) {
  return Promise.resolve()
    .then(() => {
      commitPassword(contract, password, writeOperation);
      return updateAccountReference(account, contract);
    })
    .then(
      () => null,
      (error) => error.message,
    );
}

/** One sign-in answer: its verdict and what the page showed that decided it. */
const answer = (verdict, reason) => ({ verdict, reason });

/** The verdict an identity judgement gives, or unavailable with the reason the page offered neither. */
async function challengeOr(page, absent) {
  const challenged = await judged(page, IDENTITY_CHALLENGE);
  if (!challenged.ok) return answer('unavailable', challenged.reason);
  if (challenged.shows)
    return answer(
      'identity_challenge',
      `Microsoft asks to verify identity at ${page.url()}`,
    );
  return answer('unavailable', absent);
}

/**
 * Sign in on the authorized context. Answers { verdict, reason }: verdict is
 * 'authenticated' | 'rejected' | 'identity_challenge' | 'account_unknown' |
 * 'unavailable', and reason says what the page showed (or why the model
 * could not judge it) for that verdict.
 */
export async function signIn(session, contract, password) {
  const page = session.page;
  // The token cache of an earlier authorized context has to go before this
  // login, so the claims asserted afterwards are evidence of this login; a
  // cache that cannot be dropped fails the sign-in with its cause.
  if (AUTHORIZED_CONTEXT_HOST.test(new URL(page.url()).hostname))
    await page.evaluate(() => {
      globalThis.localStorage?.clear();
      globalThis.sessionStorage?.clear();
    });
  await session.ctx.clearCookies();
  await page.goto(AUTHORIZED_CONTEXT_URL, { waitUntil: 'domcontentloaded' });
  await pageSettled(page);
  const emailInput = page
    .locator('input[name="loginfmt"], input#i0116, input[type="email"]')
    .first();
  if (!(await appears(emailInput)) || !(await visible(emailInput)))
    return answer(
      'unavailable',
      `the sign-in page at ${page.url()} shows no email field`,
    );
  // fillVerified proves the field holds the whole UPN before it is sent, so
  // Microsoft's "isn't in our system" answer is about the account, not a
  // truncated submit, and resubmitting the same value cannot change it.
  await fillVerified(page, emailInput, contract.accountUpn);
  await humanClickLocator(page, page.locator(SUBMIT).first());
  await pageSettled(page);
  const unknown = await judged(
    page,
    'Does the page say this account does not exist or could not be found?',
  );
  if (!unknown.ok) return answer('unavailable', unknown.reason);
  if (unknown.shows)
    return answer(
      'account_unknown',
      `Microsoft says ${contract.accountUpn} does not exist`,
    );
  await choosePasswordSignIn(page);
  const passwordInput = page
    .locator('input[name="passwd"], input#i0118, input[type="password"]')
    .first();
  if (!(await appears(passwordInput)) || !(await visible(passwordInput)))
    return challengeOr(
      page,
      `the sign-in page at ${page.url()} offers no password field`,
    );
  await fillVerified(page, passwordInput, password);
  await humanClickLocator(page, page.locator(SUBMIT).first());
  await pageSettled(page);
  // A refused password leaves Microsoft's password field on screen.
  if (await visible(page.locator('input[name="passwd"], input#i0118')))
    return answer(
      'rejected',
      'Microsoft kept the password field on screen after the password was sent',
    );
  const staySignedIn = await answerStaySignedIn(page);
  if (!staySignedIn.ok) return answer('unavailable', staySignedIn.reason);
  const challenged = await judged(page, IDENTITY_CHALLENGE);
  if (!challenged.ok) return answer('unavailable', challenged.reason);
  if (challenged.shows)
    return answer(
      'identity_challenge',
      `Microsoft asks to verify identity at ${page.url()}`,
    );
  await pageSettled(page);
  if (
    !AUTHORIZED_CONTEXT_URL_PATTERN.test(page.url()) ||
    !AUTHORIZED_CONTEXT_HOST.test(new URL(page.url()).hostname)
  )
    return challengeOr(
      page,
      `the sign-in ended at ${page.url()}, outside the authorized context`,
    );
  return answer('authenticated', `signed in at ${page.url()}`);
}

// Shared tail: fresh login with the value the provider now holds, full identity
// assertion, then the Skarbiec commit. Never commits an unasserted identity. A
// commit that failed answers committed: false with the cause in commitFailure.
export async function commitAfterFreshLogin(session, account, contract, plan) {
  const { password, writeOperation, sink, proxyUrl, providerEffect, evidence } =
    plan;
  const signedIn = await signIn(session, contract, password);
  evidence.push(`fresh_login_verification:${signedIn.verdict}`);
  if (signedIn.verdict !== 'authenticated') {
    const challenged = signedIn.verdict === 'identity_challenge';
    return {
      committed: false,
      answer: outcome(contract, {
        status: challenged ? 'needs_human_approval' : 'operation_failed',
        code: challenged
          ? 'ENTRA_FRESH_LOGIN_REQUIRES_HUMAN_APPROVAL'
          : 'ENTRA_FRESH_LOGIN_FAILED',
        phase: challenged
          ? 'identity_verification'
          : 'fresh_login_verification',
        retryable: signedIn.verdict !== 'rejected',
        providerEffect,
        reason: challenged
          ? `the fresh Entra login after the password write needs interactive identity approval: ${signedIn.reason}`
          : `the fresh Entra login with the newly written password did not authenticate (${signedIn.verdict}): ${signedIn.reason}`,
      }),
    };
  }
  const identity = await assertEntraIdentity(session, contract, sink);
  if (!identity.ok) {
    return {
      committed: false,
      answer: outcome(contract, {
        status: 'operation_failed',
        code: identity.code,
        phase: 'identity_verification',
        retryable: identity.retryable,
        providerEffect,
        reason: identity.reason,
      }),
    };
  }
  evidence.push('identity_verification:confirmed');
  const commitFailure = await skarbiecCommit(
    account,
    contract,
    password,
    writeOperation,
  );
  if (commitFailure) return { committed: false, answer: null, commitFailure };
  evidence.push(`skarbiec_commit:${writeOperation}`);
  const cookies = await session.ctx.cookies();
  await persistFreshCookieJar(account, cookies, { currentProxyUrl: proxyUrl });
  return { committed: true, answer: null };
}
