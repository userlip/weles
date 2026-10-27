// Reddit login through the form, for the active Reddit account.
//
// Reddit serves www.reddit.com to signed-out visitors too, so the login is
// always the form: the account's email (or its username) and its password
// from the account record. The login is answered by leaving /login or by
// the form's own alert, whose text is the failure. The account's verdict
// is then read through the shared ban-signal reader and kept in the run's
// ban_signal.json by the shared verdict writer; an exit IP Reddit's edge
// blocks clears the account's stored proxy so the next attempt rerolls it,
// and only a healthy verdict saves the session's cookies and passes.
import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { detectRedditBanSignals } from '../../../dist/platforms/reddit/ban_signals.js';
import { banSignalOf } from '../_shared/auth/ban-signal.mjs';
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { persistFreshCookieJar } from '../_shared/auth/cookie-freshness.mjs';
import { replaceAccountMetadata } from '../_shared/skarbiec/accounts.mjs';
import { pageSettled, submitAnswered } from '../_shared/page/settled.mjs';
import { keepVerdict } from '../_shared/action/verdict.mjs';

const LABEL = 'reddit_login';
const LOGIN_URL = 'https://www.reddit.com/login';

const acct = await getSocialAccount('reddit');
if (!acct) throw new Error('no active reddit account to log in');
const LOGIN = acct.metadata?.email ? acct.metadata.email : acct.username;
const PASSWORD = acct.metadata?.password;
if (!PASSWORD)
  throw new Error(
    `the reddit account ${acct.username} records no password to log in with`,
  );
console.log(`[trajectory] Using account: ${acct.username}`);

/** Forget the account's stored proxy, so the next attempt rolls a new exit. */
function wipeStoredProxy() {
  const { proxy: _drop, ...metadata } = acct.metadata;
  replaceAccountMetadata(acct.id, metadata);
  acct.metadata = metadata;
  console.log(
    `[proxy-rotate] cleared stored proxy for account ${acct.id}; the next attempt rerolls it`,
  );
}

/** A refusal carrying the verdict it was decided by. */
function refused(message, banSignal) {
  return Object.assign(new Error(message), { banSignal });
}

/** Type the login into Reddit's form and submit it with Enter. */
async function submitLoginForm(s) {
  // The form is a <faceplate-form> web component; Playwright pierces its
  // open shadow root, and Enter submits it where the button is out of reach.
  const userIn = s.page
    .locator(
      'input#login-username, input[name="username"], input[autocomplete="username"]',
    )
    .filter({ visible: true })
    .first();
  await userIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, userIn);
  await pageSettled(s.page);
  await humanType(s.page, LOGIN);
  const pwIn = s.page
    .locator(
      'input#login-password, input[name="password"], input[type="password"]',
    )
    .filter({ visible: true })
    .first();
  await pwIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, pwIn);
  await pageSettled(s.page);
  await humanType(s.page, PASSWORD);
  await pageSettled(s.page);
  await pwIn.press('Enter');
  const loginAlert = s.page
    .locator('[role="alert"]')
    .filter({ visible: true })
    .first();
  if ((await submitAnswered(s.page, /\/login/, loginAlert)) === 'message')
    throw new Error(
      `reddit login refused: ${(await loginAlert.innerText()).trim()}`,
    );
}

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: LABEL,
  proxy: proxyUrl,
  persona,
});
try {
  await s.goto(LOGIN_URL);
  const early = await banSignalOf(
    detectRedditBanSignals,
    s,
    'on the login page',
  );
  if (early.signal === 'ip_blocked')
    throw refused(
      'reddit edge blocked this exit IP before the login form',
      early,
    );
  await submitLoginForm(s);
  const banSignal = await banSignalOf(
    detectRedditBanSignals,
    s,
    'after the login',
  );
  console.log(
    `[ban-signal] ${banSignal.signal} (${JSON.stringify(banSignal.details)})`,
  );
  if (!banSignal.healthy)
    throw refused(
      `the page reads ${banSignal.signal} after the login`,
      banSignal,
    );
  await persistFreshCookieJar(acct, await s.ctx.cookies(), {
    currentProxyUrl: proxyUrl,
    currentPersona: persona,
  });
  await keepVerdict(LABEL, acct, banSignal);
  console.log(`PASS: logged in (${s.page.url()})`);
} catch (e) {
  const banSignal = e.banSignal
    ? e.banSignal
    : await banSignalOf(detectRedditBanSignals, s, 'after the failure');
  console.log(`[ban-signal] ${banSignal.signal}  FAIL: ${e.message}`);
  if (banSignal.signal === 'ip_blocked') wipeStoredProxy();
  try {
    await keepVerdict(LABEL, acct, banSignal);
  } catch (writeError) {
    throw new AggregateError(
      [e, writeError],
      `${e.message}; and its ban signal was not kept: ${writeError.message}`,
    );
  }
  throw e;
} finally {
  await s.close();
}
