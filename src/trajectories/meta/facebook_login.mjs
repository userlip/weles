// Facebook form login. Refreshes cookies for an existing social_accounts
// row (platform='facebook') by walking facebook.com/login and persisting
// the resulting jar via persistFreshCookieJar. Used by cross_login
// (tiktok_login_via_facebook / instagram_login_via_facebook /
// producthunt_login_via_facebook) and the periodic login-refresh cron.

import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { humanType } from '../../../dist/human/keyboard.js';
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../dist/human/mouse.js';
import { persistFreshCookieJar } from '../_shared/auth/cookie-freshness.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { isLoginUrl } from './ads/session/login_wall.mjs';

const URL = 'https://www.facebook.com/login';

const acct = await getSocialAccount('facebook');
if (!acct) throw new Error('FACEBOOK_ACCOUNT_UNAVAILABLE: no active facebook account in Skarbiec');
const email = acct.metadata?.email ? acct.metadata.email : acct.username;
const password = acct.metadata?.password;
if (!password) throw new Error(`FACEBOOK_PASSWORD_UNAVAILABLE: facebook account ${acct.username} has no password`);
console.log(`[fb-login] using account: ${acct.username} <${email}>`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'facebook_login',
  proxy: proxyUrl,
  persona,
});

try {
  await s.goto(URL);
  await humanIdlePause('deliberate');

  // Cookie banner — a fixed-position overlay Meta marks with its own test id.
  const cookieBtn = s.page
    .locator('button[data-testid="cookie-policy-manage-dialog-accept-button"]')
    .filter({ visible: true })
    .first();
  if (await cookieBtn.isVisible()) {
    await humanClickLocator(s.page, cookieBtn);
    await humanIdlePause('deliberate');
  }

  // 1. Email or mobile.
  const emailIn = s.page
    .locator('input#email, input[name="email"], input[type="email"]')
    .filter({ visible: true })
    .first();
  await emailIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, emailIn);
  await humanType(s.page, email);

  // 2. Password.
  const pwIn = s.page
    .locator('input#pass, input[name="pass"], input[type="password"]')
    .filter({ visible: true })
    .first();
  await pwIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, pwIn);
  await humanType(s.page, password);

  // 3. Submit from the password field.
  await pwIn.press('Enter');
  await humanIdlePause('long');

  // 4. "Save your login info?" / new-device prompt — accept and continue.
  if (
    await clickOffered(
      s.page,
      'the button that saves the login info or continues',
    )
  )
    await humanIdlePause('deliberate');

  // 5. Confirm we landed on home (a checkpoint or login route is a fail signal).
  const finalUrl = s.page.url();
  if (isLoginUrl(finalUrl)) {
    throw new Error(`facebook_checkpoint: ${finalUrl}`);
  }
  if (!/facebook\.com\/(\?|$|home)/.test(finalUrl)) {
    // Confirm the session on the home page before the jar is persisted.
    await s.page.goto('https://www.facebook.com/');
    await humanIdlePause('deliberate');
    const landed = s.page.url();
    if (!/facebook\.com\/(\?|$|home)/.test(landed))
      throw new Error(`facebook_session_unconfirmed: ${landed}`);
  }

  const cookies = await s.ctx.cookies();
  const persisted = await persistFreshCookieJar(acct, cookies, {
    currentProxyUrl: proxyUrl,
    currentPersona: persona,
  });
  if (!persisted.ok) throw new Error(`facebook_persist_failed: ${persisted.reason}`);
  console.log(`PASS: facebook logged in (${cookies.length} cookies persisted)`);
} finally {
  await s.close();
}
