// The converged Microsoft screens an Entra login walks through, read by the
// vision model in whatever language and copy Microsoft serves them, and the
// verdict wrapper every Entra step branches on.
//
// A judgement the model could not give is its own answer carrying the reason,
// never a screen that showed nothing: a caller answers 'unavailable' where
// nothing was submitted yet and 'ambiguous' where a password was already sent.

import { humanClickLocator } from '../../../../../dist/human/mouse.js';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import {
  clickDescribed,
  pageShows,
} from '../../../_shared/page/judged/seen.mjs';

export const IDENTITY_CHALLENGE =
  'Does the page ask to verify identity with a code, an authenticator app, an approval on another device, a text or call to a phone, a passkey or a security key?';

// Whether the locator resolves to a visible element; a page that refuses the
// question raises, so a closed page is never read as an absent control.
export async function visible(locator) {
  return Boolean(await locator.count()) && (await locator.first().isVisible());
}

// Whether the control shows once its page has settled; a missing control is
// an answer the caller names, not an error the caller never hears about.
export async function appears(locator) {
  await pageSettled(locator.page());
  return visible(locator);
}

// { ok: true, shows } when the model answered the yes/no question about the
// settled page, { ok: false, reason } (also logged) when it could not.
export async function judged(page, question) {
  try {
    return { ok: true, shows: await pageShows(page, question) };
  } catch (error) {
    const reason = `the vision model could not judge "${question}" on ${page.url()}: ${error.message}`;
    console.log(`[entra] ${reason}`);
    return { ok: false, reason };
  }
}

// Declines Microsoft's "stay signed in" question when the page asks it.
// Answers the judgement, so an unanswered question reaches the caller.
export async function answerStaySignedIn(page) {
  const asked = await judged(
    page,
    'Does the page ask whether to stay signed in?',
  );
  if (asked.ok && asked.shows) {
    await clickDescribed(page, 'the button that declines staying signed in');
  }
  return asked;
}

// Walks the converged sign-in surfaces until the password credential is
// chosen. A passkey prompt is cancelled into the surface whose other ways to
// sign in carry the password; the bare chooser that only offers a passkey and
// an organization is backed out of, and the email is resubmitted for another
// pass. Taking the same step from the same surface a second time means the
// walk goes round in a circle, and that is the error, named with the steps.
export async function choosePasswordSignIn(page) {
  const taken = [];
  let from = 'start';
  const step = (surface) => {
    const move = `${from} -> ${surface} (${page.url()})`;
    if (taken.includes(move)) {
      throw new Error(
        `Microsoft sign-in repeated the step ${move} without offering the password; steps: ${taken.join(', ')}`,
      );
    }
    taken.push(move);
    from = surface;
  };
  for (;;) {
    const passwordInput = page
      .locator('input[name="passwd"], input#i0118, input[type="password"]')
      .first();
    if (await visible(passwordInput)) return;
    if (
      await pageShows(page, 'Does the page offer to sign in with a password?')
    ) {
      await clickDescribed(page, 'the option to sign in with a password');
      return;
    }
    if (
      await pageShows(
        page,
        'Does the page ask to sign in with a passkey (face, fingerprint, PIN or security key) right now?',
      )
    ) {
      step('passkey page');
      await page.keyboard.press('Escape');
      await pageSettled(page);
      continue;
    }
    if (
      await pageShows(
        page,
        'Does the page offer only a passkey and signing in to an organization, without other ways to sign in?',
      )
    ) {
      step('sign-in options chooser');
      const back = page
        .locator('#idBtn_Back, button[aria-label="Back"]')
        .first();
      if (!(await visible(back))) return;
      await humanClickLocator(page, back);
      await pageSettled(page);
      continue;
    }
    const emailInput = page
      .locator('input[name="loginfmt"], input#i0116, input[type="email"]')
      .first();
    if (await visible(emailInput)) {
      step('email page');
      await emailInput.press('Enter');
      await pageSettled(page);
      continue;
    }
    if (!(await pageShows(page, 'Does the page offer other ways to sign in?')))
      return;
    step('other-ways link');
    await clickDescribed(page, 'the control that shows other ways to sign in');
  }
}
