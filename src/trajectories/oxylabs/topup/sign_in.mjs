// Signing in to the Oxylabs dashboard through Google's sign-in button, for
// every Oxylabs dashboard trajectory (top-up, ISP subscription): the GSI
// button frame on the dashboard opens Google's popup, the shared Google SSO
// answers its steps, and the dashboard then leaves its signed-out landing.
import { googleSso } from '../../_shared/services/google_sso.mjs';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled, urlMatching } from '../../_shared/page/settled.mjs';

/** Google's sign-in button frame among the page's frames. */
function gsiButtonFrame(page) {
  return page
    .frames()
    .find((frame) => new URL(frame.url()).pathname.includes('/gsi/button'));
}

export async function signInToDashboard(s, login) {
  await s.page.goto('https://dashboard.oxylabs.io/', {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(s.page);
  const gsiFrame = gsiButtonFrame(s.page);
  if (!gsiFrame)
    throw new Error(
      `OXYLABS_SIGN_IN: ${s.page.url()} shows no Google sign-in button frame`,
    );
  const [popup] = await Promise.all([
    s.page.waitForEvent('popup'),
    humanClickLocator(gsiFrame, gsiFrame.locator('div[role="button"]').first()),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  const ok = await googleSso(s, login, {
    originHost: 'oxylabs.io',
    page: popup,
  });
  if (!ok)
    throw new Error(
      `OXYLABS_SIGN_IN: Google SSO did not complete; the dashboard is at ${s.page.url()}`,
    );
  await urlMatching(
    s.page,
    /^(?!https:\/\/dashboard\.oxylabs\.io\/en\/?(\?.*)?$)/,
  );
  console.log(`[trajectory] post-login url=${s.page.url()}`);
}
