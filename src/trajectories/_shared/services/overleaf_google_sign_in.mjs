// Opening Overleaf signed in through Google SSO, the one way every Overleaf
// trajectory does it.
//
// Nothing here counts or sleeps: the Google surface is whichever comes first
// of a popup or the page itself moving to accounts.google.com, and the sign-in
// is over when the page has left Google and settled. The page's controls are
// found by the vision model in whatever language Overleaf and Google render
// them. A sign-in that ends back on Overleaf's /login throws with the URL it
// ended on.
import { WSession } from '../../../../dist/session/wsession.js';
import { SessionStore } from '../../../../dist/session/store.js';
import { googleSso, getGoogleSsoCreds } from './google_sso.mjs';
import { clickDescribed, clickOffered } from '../page/judged/seen.mjs';
import { pageSettled } from '../page/settled.mjs';

const OVERLEAF = 'https://www.overleaf.com';
const onRoute = (url, route) => new URL(url).pathname.startsWith(route);

/**
 * Sign `s` in to Overleaf with the Google `login`. `chooseAnotherAccount`
 * picks Google's "use another account" when it offers no email field.
 * Answers whether persisted cookies had already signed it in, and where it
 * settled.
 */
export async function overleafGoogleSignIn(s, login, { label, chooseAnotherAccount }) {
  await s.goto(`${OVERLEAF}/login`);
  await pageSettled(s.page);
  if (onRoute(s.page.url(), '/project')) {
    console.log(`[${label}] already authenticated via persisted cookies`);
    return { alreadySignedIn: true, url: s.page.url() };
  }
  if (await clickOffered(s.page, 'the button that accepts only essential cookies')) await pageSettled(s.page);
  const popup = s.page.waitForEvent('popup');
  const inPlace = s.page.waitForURL((url) => url.hostname === 'accounts.google.com').then(() => s.page);
  await clickDescribed(s.page, 'the button or link that logs in to Overleaf with Google');
  const surface = await Promise.any([popup, inPlace]);
  const mode = surface === s.page ? 'in-place' : 'popup';
  console.log(`[${label}] Google SSO ${mode}`);
  await surface.waitForLoadState('domcontentloaded');
  if (chooseAnotherAccount === true && !(await surface.locator('input[type="email"], input#identifierId').filter({ visible: true }).count()))
    await clickOffered(surface, 'the option to use another Google account');
  const signedIn = await googleSso(s, login, mode === 'popup' ? { originHost: 'overleaf.com', page: surface } : { originHost: 'overleaf.com' });
  if (!signedIn) throw new Error(`OVERLEAF_GOOGLE_SSO_INCOMPLETE: Google SSO for Overleaf did not complete (${mode}) at ${surface.url()}`);
  await s.page.waitForURL((url) => url.hostname !== 'accounts.google.com');
  await pageSettled(s.page);
  const url = s.page.url();
  console.log(`[${label}] settled URL: ${url}`);
  if (onRoute(url, '/login')) throw new Error(`OVERLEAF_NOT_SIGNED_IN: Overleaf returned to /login after Google SSO — ${url}`);
  return { alreadySignedIn: false, url };
}

/**
 * A browser session signed in to Overleaf and on its project dashboard.
 * With `authLabel`, the Overleaf cookies kept under it are put in first and
 * the signed-in cookies kept again after. The session is closed when the
 * sign-in fails.
 */
export async function openOverleaf({ label, authLabel, chooseAnotherAccount }) {
  const login = await getGoogleSsoCreds();
  if (!login) throw new Error('OVERLEAF_GOOGLE_LOGIN_UNAVAILABLE: the scoped Google SSO login cannot be read');
  console.log(`[${label}] Google login ${login.email}`);
  const s = await WSession.start({ label, browser: 'chromium', headful: process.env.HEADLESS !== '1' });
  try {
    const store = new SessionStore();
    if (authLabel && (await store.injectPlaywright(s.ctx, authLabel))) console.log(`[${label}] put in the cookies kept under ${authLabel}`);
    const { url } = await overleafGoogleSignIn(s, login, { label, chooseAnotherAccount });
    if (!onRoute(url, '/project')) {
      await s.goto(`${OVERLEAF}/project`);
      await pageSettled(s.page);
    }
    if (authLabel) await store.capturePlaywright(s.ctx, authLabel);
    return { s, login };
  } catch (error) {
    await s.close();
    throw error;
  }
}
