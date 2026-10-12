// Whether the public no-login scanner sits behind a Cloudflare Turnstile gate
// and whether this run passes it. The gate is Cloudflare's own frame, served
// from challenges.cloudflare.com, and the token it writes into the form's
// cf-turnstile-response field; whether the scan button is enabled is judged by
// the vision model, which reads it in whatever words Pangram uses.

import { pageCondition } from '../../../_shared/page/settled.mjs';
import { clickOffered, pageShows } from '../../../_shared/page/judged/seen.mjs';

const TURNSTILE_HOST = 'challenges.cloudflare.com';
const TURNSTILE_TOKEN = 'input[name="cf-turnstile-response"]';

// { turnstile, scanEnabled }: whether Cloudflare's gate is on the page, and
// whether the scan button is enabled.
async function publicVerificationState(page) {
  const turnstile =
    page
      .frames()
      .some(
        (frame) =>
          URL.canParse(frame.url()) &&
          new URL(frame.url()).hostname === TURNSTILE_HOST,
      ) || Boolean(await page.locator(TURNSTILE_TOKEN).count());
  const scanEnabled = await pageShows(
    page,
    'Is the button that scans the text for AI shown and enabled?',
  );
  return { turnstile, scanEnabled };
}

/** Pass the public checker's Turnstile gate: click its checkbox when the run
 * may, then wait until Turnstile writes its token into the form — for as long
 * as the gate (or the person solving it) takes. */
export async function waitForPublicVerificationIfNeeded(page) {
  const state = await publicVerificationState(page);
  if (!state.turnstile || state.scanEnabled) return state;
  const turnstileClick =
    process.env.PANGRAM_CLICK_PUBLIC_TURNSTILE !== '0' &&
    (await clickOffered(
      page,
      'the checkbox of the Cloudflare human-verification widget',
    ));
  await pageCondition(
    page,
    (selector) => Boolean(document.querySelector(selector)?.value),
    TURNSTILE_TOKEN,
  );
  return { ...(await publicVerificationState(page)), turnstileClick };
}
