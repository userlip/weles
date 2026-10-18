/**
 * Cloudflare challenge handling for a loaded page. A page whose DOM carries
 * no Cloudflare challenge marker is not challenged and costs no model call.
 * A page that does is judged by the vision model (a boolean answer through
 * checkPage); a challenge page has its verification control located by the
 * model and clicked with page.mouse, and the wait then follows the page's
 * loads until one is no longer a challenge. A DOM probe or a model question
 * that fails throws with its cause instead of reading as "not challenged".
 */

import {
  checkPage,
  findClickTarget,
  type ScreenshottablePage,
} from '../vision/analyze.js';

const CHALLENGE_QUESTION =
  'Is this a Cloudflare security verification or challenge page?';

// Resolves on the page's next document load. Cloudflare clears a challenge by
// loading the protected page in place, so each load is the moment to look again.
function nextLoad(page: any): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const onLoad = () => {
    page.off('load', onLoad);
    resolve();
  };
  page.on('load', onLoad);
  return promise;
}

// A challenge page carries Cloudflare's challenge options object and its
// challenge-platform script or frame, whatever its wording. A page the probe
// cannot run in is that failure, thrown with its cause.
async function looksLikeCloudflareDom(page: any): Promise<boolean> {
  return Boolean(
    await page.evaluate(
      () =>
        '_cf_chl_opt' in window ||
        Boolean(
          document.querySelector(
            'script[src*="/cdn-cgi/challenge-platform/"], iframe[src*="challenges.cloudflare.com"], iframe[src*="cdn-cgi/challenge-platform"]',
          ),
        ),
    ),
  );
}

export async function waitCloudflare(page: any): Promise<boolean> {
  await page.waitForLoadState('load');
  if (!(await looksLikeCloudflareDom(page))) return true;
  if (!(await checkPage(page as ScreenshottablePage, CHALLENGE_QUESTION))) {
    console.log(
      '  [cloudflare] challenge markers present, page judged not a challenge',
    );
    return true;
  }
  console.log('  [cloudflare] challenge detected');

  // The next load is listened for before anything is clicked or checked, so
  // a load that lands during the click or a model call is not missed.
  let pending = nextLoad(page);
  const target = await findClickTarget(
    page as ScreenshottablePage,
    'the checkbox or button to verify you are human',
  );
  if (target) {
    await page.mouse.click(target.x, target.y);
    console.log(
      `  [cloudflare] clicked the verification control at (${target.x}, ${target.y})`,
    );
  } else {
    console.log(
      '  [cloudflare] the model located no verification control; waiting for the challenge to pass by itself',
    );
  }

  // Cloudflare loads the protected page in place when it lets the browser
  // through. Each load is checked once; a load that is still the challenge
  // waits for the next one, and an operator cancelling the run still ends it.
  for (;;) {
    await pending;
    pending = nextLoad(page);
    if (!(await looksLikeCloudflareDom(page))) return true;
    const stillChallenged = await checkPage(
      page as ScreenshottablePage,
      CHALLENGE_QUESTION,
    );
    console.log(
      `  [cloudflare] page loaded; still challenged = ${stillChallenged}`,
    );
    if (!stillChallenged) return true;
  }
}

export async function isChallenged(page: any): Promise<boolean> {
  return checkPage(page as ScreenshottablePage, CHALLENGE_QUESTION);
}

/** The same wait as waitCloudflare, under the name the public API exports. */
export async function bypassCloudflare(page: any): Promise<boolean> {
  return waitCloudflare(page);
}

export type { ScreenshottablePage as CFPage };
