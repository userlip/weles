// Watching Google's device prompt while a person approves it on a phone:
// where Google's page stands (still on the prompt, gone to another challenge,
// ended on one of its info pages), what it announces once the wait began,
// and the wait for the operator to be ready before anything is sent. The
// page is read by its host and path, through the shared Google session
// reader's host; whether a new alert is the prompt expiring or a refusal is
// decided by the caller from what the page then offers.
import { pageCondition } from '../../../../page/settled.mjs';
import { noteOperatorRequest } from '#operator-request';
import { GOOGLE_ACCOUNTS_HOST } from '../../../../profile/google_session.mjs';
import { nextApprovalEvent } from './wait.mjs';

// Google's routes: the device prompt, any challenge, and the info pages that
// end a sign-in.
const ROUTES = {
  host: GOOGLE_ACCOUNTS_HOST,
  devicePrompt: '/signin/challenge/dp',
  challenge: '/signin/challenge',
  info: '/info/',
};

function onRoute(pathname, route) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

/** Whether `page` shows Google's device prompt. */
export function onDevicePrompt(page) {
  const { hostname, pathname } = new URL(page.url());
  return hostname === ROUTES.host && onRoute(pathname, ROUTES.devicePrompt);
}

/** Whether `page` shows any Google challenge. */
export function onChallenge(page) {
  const { hostname, pathname } = new URL(page.url());
  return hostname === ROUTES.host && onRoute(pathname, ROUTES.challenge);
}

export function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  error.fatal2fa = true;
  return error;
}

/**
 * The texts of the alerts the page already announces. Google's device prompt
 * carries its own live regions (its heading block is aria-live), so what the
 * page announced when the wait began is the prompt itself; only an alert it
 * shows afterwards is an answer.
 */
export function announcedNow(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="alert"], [aria-live="assertive"]')]
      .map((alert) => alert.innerText.trim())
      .filter(Boolean),
  );
}

/**
 * Resolves `{ page: answer }` once Google's page answers the prompt: it left
 * the prompt (`{ left, refused, detail }`, refused when for another
 * challenge), ended the sign-in on an info page (`{ ended, detail }`), or
 * showed an alert it had not announced before (`{ alert, detail }`).
 */
export function watchDevicePrompt(page, announced) {
  const watched = pageCondition(
    page,
    ({ before, routes }) => {
      const under = (route) =>
        location.pathname === route ||
        location.pathname.startsWith(`${route}/`);
      const google = location.hostname === routes.host;
      const detail = `${location.origin}${location.pathname}`;
      if (!google || !under(routes.devicePrompt)) {
        if (google && location.pathname.startsWith(routes.info))
          return { ended: true, detail };
        return { left: true, refused: google && under(routes.challenge), detail };
      }
      for (const alert of document.querySelectorAll(
        '[role="alert"], [aria-live="assertive"]',
      )) {
        const text = alert.innerText.trim();
        if (alert.checkVisibility() && text && !before.includes(text))
          return { alert: true, detail: `Google displayed: ${text}` };
      }
      return false;
    },
    { before: announced, routes: ROUTES },
  ).then((answer) => ({ page: answer }));
  // An operator answer can end the wait while this page read is pending; its
  // later failure (the page closing) is reported, not left unhandled.
  watched.catch((error) =>
    console.log(
      `[google_sso] the device prompt watch ended after the wait did: ${error.message}`,
    ),
  );
  return watched;
}

/**
 * Wait until the operator answers ready, before anything is sent to his
 * phone; returns the answers seen. Another answer is recorded and the wait
 * goes on. Google's page leaving the challenge while it waits ends the
 * sign-in by name: Google ended it, and no prompt was sent.
 */
export async function untilReady(page, request, seen) {
  const left = pageCondition(
    page,
    (routes) =>
      location.hostname === routes.host &&
      (location.pathname === routes.challenge ||
        location.pathname.startsWith(`${routes.challenge}/`))
        ? false
        : { detail: `${location.origin}${location.pathname}` },
    ROUTES,
  ).then((moved) => ({ page: moved }));
  left.catch((error) =>
    console.log(
      `[google_sso] the challenge watch ended after the operator answered: ${error.message}`,
    ),
  );
  let answered = seen;
  for (;;) {
    const outcome = await nextApprovalEvent(left, request.id, answered);
    if (outcome.page) {
      throw failure(
        `Google left its challenge for ${outcome.page.detail} while the run waited for the operator to be ready (asked at ${request.opened_at}); no prompt was sent, and a new run of the same action starts the sign-in again`,
        'google_sign_in_ended_during_approval',
      );
    }
    answered++;
    if (outcome.operator.answer === 'ready') {
      noteOperatorRequest(
        request.id,
        "The operator is ready; the run chooses Google's phone method, which sends the prompt",
      );
      return answered;
    }
    noteOperatorRequest(
      request.id,
      `The operator answered ${outcome.operator.answer} before any prompt was sent; the run sends Google's prompt only after he answers ready`,
    );
  }
}
