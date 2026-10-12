import {
  getSocialAccount,
  markCookiesStale,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { humanType } from '../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { urlMatching } from '../_shared/page/settled.mjs';
import { assertAuthed, AuthProbeError } from '../_shared/auth/auth-probe.mjs';
import {
  loadFreshCookieJarOrFail,
  CookieJarStaleError,
} from '../_shared/auth/cookie-freshness.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';

const TARGET = statedText(
  ['TARGET_USERNAME'],
  'the Snapchat user a real account sends a friend request to',
);
const LOGIN_URL = 'https://accounts.snapchat.com/accounts/login';
// The web app answers only a signed-in session; any other host it lands on
// is the sign-in it sent the browser to.
const WEB_APP = new URL('https://web.snapchat.com/');

const acct = await getSocialAccount('snapchat');
if (!acct)
  throw new Error(
    'SNAPCHAT_ACCOUNT_UNAVAILABLE: no active snapchat account in the account store',
  );
console.log(`[trajectory] Using account: ${acct.username} target=${TARGET}`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'snapchat_add_friend',
  proxy: proxyUrl,
  persona,
});
try {
  // Cookie freshness gate — see _shared/auth/cookie-freshness.mjs. On stale,
  // skip injection so the form-login fallback below kicks in (snapchat
  // login is part of this trajectory's recovery path).
  let stored = [];
  try {
    stored = loadFreshCookieJarOrFail(acct, {
      platform: 'snapchat',
      label: 'snapchat_add_friend',
      currentProxyUrl: proxyUrl,
      currentPersona: persona,
    });
  } catch (jarErr) {
    if (!(jarErr instanceof CookieJarStaleError)) throw jarErr;
    console.log(
      `[snapchat_add_friend] ${jarErr.message} — falling through to form login`,
    );
    stored = [];
  }
  // A stored cookie the browser refuses fails here with Playwright's cause.
  if (stored.length)
    await s.ctx.addCookies(
      stored.filter((c) => c?.name && c?.value && (c.domain || c.url)),
    );

  await s.goto(WEB_APP.href);
  await humanIdlePause('deliberate');
  if (new URL(s.page.url()).hostname !== WEB_APP.hostname) {
    const password = acct.metadata?.password;
    if (!password)
      throw new Error(
        `SNAPCHAT_PASSWORD_UNAVAILABLE: the web app sent the session to ${s.page.url()} and account ${acct.username} stores no password to sign in again`,
      );
    await s.goto(LOGIN_URL);
    await humanIdlePause('deliberate');
    const userIn = s.page
      .locator(
        'input[name="username"], input#username, input[autocomplete="username"], input[type="email"]',
      )
      .filter({ visible: true })
      .first();
    await humanClickLocator(s.page, userIn);
    await humanType(s.page, acct.username);
    // Each step is submitted by its own form from the field just typed in.
    await s.page.keyboard.press('Enter');
    const pwIn = s.page
      .locator('input[name="password"], input[type="password"]')
      .filter({ visible: true })
      .first();
    await pwIn.waitFor({ state: 'visible' });
    await humanClickLocator(s.page, pwIn);
    await humanType(s.page, password);
    await s.page.keyboard.press('Enter');
    await urlMatching(
      s.page,
      (url) => new URL(url).pathname !== new URL(LOGIN_URL).pathname,
    );
    await s.goto(WEB_APP.href);
    await humanIdlePause('deliberate');
  }

  // Positive auth probe — see _shared/auth/auth-probe.mjs.
  try {
    await assertAuthed('snapchat', s, { label: 'snapchat_add_friend' });
  } catch (probeErr) {
    if (probeErr instanceof AuthProbeError) await markCookiesStale(acct.id);
    throw probeErr;
  }

  // web.snapchat.com — use the search/add input. Search box is contenteditable
  // div with role="textbox" / aria-label="Search".
  const searchBox = s.page
    .locator(
      'div[role="textbox"][contenteditable="true"], input[type="search"], input[aria-label*="Search" i]',
    )
    .filter({ visible: true })
    .first();
  await searchBox.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, searchBox);
  await humanType(s.page, TARGET);
  // First "Add Friend" button in the result list.
  const addBtn = s.page
    .locator(
      'button:has-text("Add Friend"), button:has-text("Add"), [role="button"]:has-text("Add Friend")',
    )
    .filter({ visible: true })
    .first();
  await addBtn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, addBtn);
  await s.page
    .locator(
      'button:has-text("Added"), button:has-text("Pending"), [role="button"]:has-text("Added")',
    )
    .first()
    .waitFor({ state: 'visible' });
  console.log(`PASS: added ${TARGET}`);
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close();
}
