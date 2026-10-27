// LinkedIn's sign-in form and its checkpoint routes, for every run that signs
// a LinkedIn account in (the login, and the inline relogin of an action).
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled, urlMatching } from '../page/settled.mjs';
import { clickDescribed } from '../page/judged/seen.mjs';
import { injectV3LoginToken } from './checkpoint.mjs';

// LinkedIn's checkpoint routes, and its sign-in page.
const CHECKPOINT_ROUTES = ['/checkpoint', '/uas/login', '/login/recovery'];
const SIGN_IN_ROUTE = '/login';
const routeOf = (url) => new URL(url).pathname.replace(/\/$/, '');

/** Whether `url` is one of LinkedIn's checkpoint routes. */
export function onCheckpointRoute(url) {
  return CHECKPOINT_ROUTES.some((route) => routeOf(url).startsWith(route));
}

/** Whether `url` is LinkedIn's sign-in page itself. */
export function onSignInPage(url) {
  return routeOf(url) === SIGN_IN_ROUTE;
}

/**
 * Type the email and password into LinkedIn's sign-in form and submit it,
 * on either of its shells (the legacy form, the SDUI page whose button posts
 * through React; the sign-in control is found by sight on both). The login
 * token LinkedIn's invisible reCAPTCHA asks for is solved first. Resolves
 * once LinkedIn has left the sign-in page, or shown its own field error, and
 * the page has settled.
 */
export async function submitLinkedinPassword(s, login, password) {
  const address = s.page
    .locator('input#username, input[name="session_key"], input[type="email"]')
    .filter({ visible: true })
    .first();
  const secret = s.page
    .locator(
      'input#password, input[name="session_password"], input[type="password"]',
    )
    .filter({ visible: true })
    .first();
  await address.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, address);
  await humanType(s.page, login);
  await humanClickLocator(s.page, secret);
  await humanType(s.page, password);
  await injectV3LoginToken(s.page);
  await clickDescribed(
    s.page,
    'the button that signs in with the typed email and password',
  );
  await Promise.any([
    urlMatching(s.page, (url) => !onSignInPage(url)),
    s.page
      .locator('#error-for-password, #error-for-username, [role="alert"]')
      .filter({ hasText: /\S/ })
      .first()
      .waitFor({ state: 'visible' }),
  ]);
  await pageSettled(s.page);
}
