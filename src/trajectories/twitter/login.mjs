// Sign the active X account in through x.com's login flow, through the
// shared login runner (../_shared/action/login.mjs): the account, its
// proxy, the kept session and the verdict are the runner's.
//
// Each step of the flow is answered by X with its next step, its own alert,
// or a challenge input (a phone or email confirmation, a code); the run
// waits for whichever comes and reads which. An alert is the refusal,
// quoted; a challenge is a checkpoint; X's account-access routes mean the
// account is suspended, which deactivates it. The login counts once X lands
// on /home.
import { humanFill } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { deactivateAccount } from '../../../dist/account/state.js';
import { detectTwitterBanSignals } from '../../../dist/platforms/twitter/ban_signals.js';
import { runLogin } from '../_shared/action/login.mjs';
import { pageCondition, pageSettled } from '../_shared/page/settled.mjs';

const LOGIN_URL = 'https://x.com/i/flow/login';
const HOME_ROUTE = '/home';
const SUSPENDED_ROUTES = ['/account/access'];
const ADDRESS = 'input[autocomplete="username"]';
const PASSWORD = 'input[autocomplete="current-password"], input[name="password"]';
// X's challenge step: a free-text input that is neither the address nor
// the password field.
const CHALLENGE = '[data-testid="ocfEnterTextTextInput"]';

/**
 * Which answer the flow gave: 'left' (the page left the login flow),
 * 'alert', 'challenge', or `expected` when that field showed.
 */
function flowAnswer(page, expected) {
  return pageCondition(
    page,
    ({ wanted, challenge }) => {
      if (!location.pathname.startsWith('/i/flow/login')) return 'left';
      const alert = document.querySelector('[role="alert"]');
      if (alert?.textContent.trim()) return 'alert';
      if (document.querySelector(challenge)) return 'challenge';
      return wanted && document.querySelector(wanted) ? 'expected' : false;
    },
    { wanted: expected, challenge: CHALLENGE },
  );
}

/** Throw for an answer that is not the next step. */
async function refuseAnswer(s, acct, answer) {
  const url = s.page.url();
  if (answer === 'alert')
    throw new Error(`TWITTER_LOGIN_REFUSED: ${(await s.page.locator('[role="alert"]').first().innerText()).trim()}`);
  if (answer === 'challenge')
    throw Object.assign(new Error(`TWITTER_CHALLENGE: X asks ${acct.username} to confirm the login at ${url}`), {
      banSignal: { signal: 'checkpoint', healthy: false, details: { final_url: url } },
    });
  if (SUSPENDED_ROUTES.some((route) => new URL(url).pathname.startsWith(route))) {
    await deactivateAccount(acct.id, acct.metadata, 'TWITTER_SUSPENDED');
    throw Object.assign(new Error(`TWITTER_SUSPENDED: ${url}; ${acct.username} is deactivated`), {
      banSignal: { signal: 'suspended', healthy: false, details: { final_url: url } },
    });
  }
}

await runLogin({
  platform: 'twitter',
  banDetector: detectTwitterBanSignals,
  signIn: async (s, { acct, login, password }) => {
    await s.goto(LOGIN_URL);
    await pageSettled(s.page);
    const address = s.page.locator(ADDRESS).first();
    await address.waitFor({ state: 'visible' });
    await humanFill(s.page, address, login);
    // Enter in the address field takes the flow to its next step.
    await s.page.keyboard.press('Enter');
    const afterAddress = await flowAnswer(s.page, PASSWORD);
    if (afterAddress !== 'expected') {
      await refuseAnswer(s, acct, afterAddress);
      throw new Error(`TWITTER_LOGIN_UNEXPECTED: X left the login flow before the password, at ${s.page.url()}`);
    }
    const secret = s.page.locator(PASSWORD).first();
    await humanFill(s.page, secret, password);
    await humanClickLocator(s.page, s.page.locator('[data-testid="LoginForm_Login_Button"]').first());
    const afterPassword = await flowAnswer(s.page);
    await pageSettled(s.page);
    await refuseAnswer(s, acct, afterPassword);
    if (!new URL(s.page.url()).pathname.startsWith(HOME_ROUTE))
      throw new Error(`TWITTER_LOGIN_UNCONFIRMED: X left the login flow for ${s.page.url()}, not ${HOME_ROUTE}`);
  },
});
