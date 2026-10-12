// How a signed-in Entra session comes about on the converged Microsoft screens,
// and what happens the moment a fresh login has proven something: the reads and
// fills those screens need, the sign-in walk itself, and the Skarbiec commit
// that only an asserted identity is allowed to reach.
//
// Reading a screen and waiting for a control are evidence here, not decoration.
// The screens are read by the vision model (`sign_in/surfaces.mjs`), and a
// judgement it could not give is an answer of its own carrying the reason, so
// each caller branches on that instead of on a screen that seemed to say nothing.
//
// Moved out of entra_password_lifecycle.mjs, which keeps the three trajectory
// entry points.

import { humanFill } from '../../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
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

async function controlValue(locator) {
  try {
    return { ok: true, value: await locator.inputValue() };
  } catch (error) {
    return {
      ok: false,
      reason: `the control value could not be read back: ${error.message}`,
    };
  }
}

export async function fill(page, locator, value) {
  await locator.waitFor({ state: 'visible' });
  await humanFill(page, locator, value);
}

// The converged control re-renders during hydration and can silently drop
// keystrokes of a human-typed value — sometimes after an immediate readback
// already looked right — so every fill settles, reads back, and retries
// before the form moves on. A readback that disagreed leaves the form's own
// verdict to decide; a readback that never reached the control at all proves
// nothing about the typed value and is raised.
async function fillVerified(page, locator, value) {
  let readback;
  await fill(page, locator, value);
  await pageSettled(page);
  readback = await controlValue(locator);
  if (readback.ok && readback.value === value) return;
  if (!readback.ok) {
    throw new Error(
      `a typed sign-in value could not be verified: ${readback.reason}`,
    );
  }
}

// The token cache of an earlier authorized context has to go before this login,
// so the claims asserted afterwards are evidence of this login. A cache that
// could not be dropped is named, because reading the earlier login's tokens
// would prove the wrong session.
async function clearTokenCache(page) {
  try {
    await page.evaluate(() => {
      globalThis.localStorage?.clear();
      globalThis.sessionStorage?.clear();
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `the authorized context token cache could not be cleared: ${error.message}`,
    };
  }
}

// 'authenticated' | 'rejected' | 'identity_challenge' | 'account_unknown' | 'unavailable'
export async function signIn(session, contract, password) {
  const page = session.page;
  if (AUTHORIZED_CONTEXT_HOST.test(new URL(page.url()).hostname)) {
    const cleared = await clearTokenCache(page);
    if (!cleared.ok) return 'unavailable';
  }
  await session.ctx.clearCookies();
  await page.goto(AUTHORIZED_CONTEXT_URL, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('deliberate');
  const emailInput = page
    .locator('input[name="loginfmt"], input#i0116, input[type="email"]')
    .first();
  if (!(await appears(emailInput)) || !(await visible(emailInput)))
    return 'unavailable';
  // fillVerified proves the field holds the whole UPN before it is sent, so
  // Microsoft's "isn't in our system" answer is about the account, not a
  // truncated submit, and resubmitting the same value cannot change it.
  await fillVerified(page, emailInput, contract.accountUpn);
  await humanClickLocator(
    page,
    page
      .locator('input[type="submit"]#idSIButton9, button[type="submit"]')
      .first(),
  );
  await humanIdlePause('deliberate');
  const unknown = await judged(
    page,
    'Does the page say this account does not exist or could not be found?',
  );
  if (!unknown.ok) return 'unavailable';
  if (unknown.shows) return 'account_unknown';
  await choosePasswordSignIn(page);
  const passwordInput = page
    .locator('input[name="passwd"], input#i0118, input[type="password"]')
    .first();
  if (!(await appears(passwordInput)) || !(await visible(passwordInput))) {
    const challenged = await judged(page, IDENTITY_CHALLENGE);
    return challenged.ok && challenged.shows
      ? 'identity_challenge'
      : 'unavailable';
  }
  await fillVerified(page, passwordInput, password);
  await humanClickLocator(
    page,
    page
      .locator('input[type="submit"]#idSIButton9, button[type="submit"]')
      .first(),
  );
  await humanIdlePause('long');
  // A refused password leaves Microsoft's password field on screen.
  if (await visible(page.locator('input[name="passwd"], input#i0118')))
    return 'rejected';
  if (!(await answerStaySignedIn(page)).ok) return 'unavailable';
  const challenged = await judged(page, IDENTITY_CHALLENGE);
  if (!challenged.ok) return 'unavailable';
  if (challenged.shows) return 'identity_challenge';
  await pageSettled(page);
  if (
    !AUTHORIZED_CONTEXT_URL_PATTERN.test(page.url()) ||
    !AUTHORIZED_CONTEXT_HOST.test(new URL(page.url()).hostname)
  ) {
    const afterwards = await judged(page, IDENTITY_CHALLENGE);
    return afterwards.ok && afterwards.shows
      ? 'identity_challenge'
      : 'unavailable';
  }
  return 'authenticated';
}

// Shared tail: fresh login with the value the provider now holds, full identity
// assertion, then the Skarbiec commit. Never commits an unasserted identity.
export async function commitAfterFreshLogin(session, account, contract, plan) {
  const { password, writeOperation, sink, proxyUrl, providerEffect, evidence } =
    plan;
  const signedIn = await signIn(session, contract, password);
  evidence.push(`fresh_login_verification:${signedIn}`);
  if (signedIn !== 'authenticated') {
    return {
      committed: false,
      answer: outcome(contract, {
        status:
          signedIn === 'identity_challenge'
            ? 'needs_human_approval'
            : 'operation_failed',
        code:
          signedIn === 'identity_challenge'
            ? 'ENTRA_FRESH_LOGIN_REQUIRES_HUMAN_APPROVAL'
            : 'ENTRA_FRESH_LOGIN_FAILED',
        phase:
          signedIn === 'identity_challenge'
            ? 'identity_verification'
            : 'fresh_login_verification',
        retryable: signedIn !== 'rejected',
        providerEffect,
        reason:
          signedIn === 'identity_challenge'
            ? 'the fresh Entra login after the password write needs interactive identity approval'
            : 'the fresh Entra login with the newly written password did not authenticate',
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
  try {
    commitPassword(contract, password, writeOperation);
    await updateAccountReference(account, contract);
  } catch {
    return { committed: false, answer: null };
  }
  evidence.push(`skarbiec_commit:${writeOperation}`);
  const cookies = await session.ctx.cookies();
  await persistFreshCookieJar(account, cookies, { currentProxyUrl: proxyUrl });
  return { committed: true, answer: null };
}
