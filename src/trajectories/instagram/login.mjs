// Sign the active Instagram account in through its login form, through the
// shared login runner (../_shared/action/login.mjs): the account, its
// proxy, the kept session and the verdict are the runner's.
//
// Instagram answers the form by routing away from /accounts/login or with
// its own alert, whose text is the refusal, quoted. Its challenge routes are
// a checkpoint (the account's cookies are marked stale by the verdict
// writer); its suspended routes deactivate the account.
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { deactivateAccount, deactivationClause } from '../../../dist/account/state.js';
import { detectInstagramBanSignals } from '../../../dist/platforms/instagram/ban_signals.js';
import { runLogin } from '../_shared/action/login.mjs';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';

const LOGIN_URL = 'https://www.instagram.com/accounts/login/';
const LOGIN_ROUTE = '/accounts/login';
// Where Instagram sends an account it wants to verify, and one it has banned.
const CHECKPOINT_ROUTES = ['/challenge', '/checkpoint', '/two_factor'];
const SUSPENDED_ROUTES = ['/accounts/suspended', '/accounts/disabled'];
const ALERT = '#slfErrorAlert, [data-bloks-name*="Error"], [role="alert"]';
const routeOf = (url, routes) =>
  routes.find((route) => new URL(url).pathname.startsWith(route));

await runLogin({
  platform: 'instagram',
  banDetector: detectInstagramBanSignals,
  signIn: async (s, { acct, login, password }) => {
    await s.goto(LOGIN_URL);
    await pageSettled(s.page);
    // Instagram names its fields email and pass.
    const address = s.page.locator('input[name="email"], input[name="username"]').filter({ visible: true }).first();
    const secret = s.page.locator('input[name="pass"], input[name="password"]').filter({ visible: true }).first();
    if (!(await address.count()) || !(await secret.count()))
      throw new Error(`INSTAGRAM_LOGIN_FORM_MISSING: ${s.page.url()} shows no login form`);
    await humanClickLocator(s.page, address);
    await humanType(s.page, login);
    await humanClickLocator(s.page, secret);
    await humanType(s.page, password);
    // Enter in the focused password field submits the form it belongs to,
    // which no lookalike control on the page (a Facebook login) can take.
    await s.page.keyboard.press('Enter');
    await Promise.any([
      urlMatching(s.page, (url) => !routeOf(url, [LOGIN_ROUTE])),
      alert.waitFor({ state: 'visible' }),
    ]);
    await pageSettled(s.page);
    if (await alert.count())
      throw new Error(`INSTAGRAM_LOGIN_REFUSED: ${(await alert.innerText()).trim()}`);
    const url = s.page.url();
    if (routeOf(url, [LOGIN_ROUTE]))
      throw new Error(`INSTAGRAM_LOGIN_UNANSWERED: Instagram stayed on its login form at ${url}`);
    const checkpoint = routeOf(url, CHECKPOINT_ROUTES);
    if (checkpoint)
      throw Object.assign(new Error(`INSTAGRAM_CHECKPOINT: Instagram holds the account at ${url}`), {
        banSignal: { signal: 'checkpoint', healthy: false, details: { final_url: url } },
      });
    if (routeOf(url, SUSPENDED_ROUTES)) {
      const outcome = await deactivateAccount(acct.id, acct.metadata, 'INSTAGRAM_SUSPENDED');
      throw Object.assign(new Error(`INSTAGRAM_SUSPENDED: ${url}; ${deactivationClause(outcome, acct.username)}`), {
        banSignal: { signal: 'suspended', healthy: false, details: { final_url: url } },
      });
    }
  },
});
