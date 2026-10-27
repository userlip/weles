// Microsoft account form login — refreshes cookies for an existing
// social_accounts row (platform='microsoft') by walking login.live.com.
// Used by linkedin_login_via_microsoft + the cross_login periodic refresher.

import {
  getSocialAccount,
  resolveAccountSession,
} from '../../../dist/utils/credentials.js';
import { readWelesManagedCredential } from '../../../dist/secrets/scoped-service.js';
import { WSession } from '../../../dist/session/wsession.js';
import { humanType } from '../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { persistFreshCookieJar } from '../_shared/auth/cookie-freshness.mjs';

const LOGIN_URL = 'https://login.live.com/login.srf';

const acct = await getSocialAccount('microsoft');
if (!acct)
  throw new Error(
    'MICROSOFT_ACCOUNT_UNAVAILABLE: no active microsoft account in Skarbiec',
  );
const email = acct.metadata?.email ? acct.metadata.email : acct.username;
const credentialId = acct.metadata?.skarbiec_credential_id;
if (!credentialId)
  throw new Error(
    `MICROSOFT_PASSWORD_UNAVAILABLE: microsoft account ${acct.username} names no managed Skarbiec password`,
  );
const tenantId =
  typeof acct.metadata.skarbiec_tenant_id === 'string'
    ? acct.metadata.skarbiec_tenant_id
    : null;
if (!process.env.WELES_CREDENTIAL_CONSTRAINTS)
  process.env.WELES_CREDENTIAL_CONSTRAINTS = JSON.stringify({
    store_secret_target: 'skarbiec',
  });
const password = readWelesManagedCredential(credentialId, 'password', tenantId);
if (!password)
  throw new Error(
    `MICROSOFT_PASSWORD_UNAVAILABLE: the managed Skarbiec credential of ${acct.username} holds no password`,
  );
console.log(`[ms-login] using account: ${acct.username} <${email}>`);

const { proxyUrl, persona } = await resolveAccountSession(acct);
const s = await WSession.start({
  label: 'microsoft_login',
  proxy: proxyUrl,
  persona,
});

try {
  await s.goto(LOGIN_URL);
  await pageSettled(s.page);

  // 1. Email
  const emailIn = s.page
    .locator('input[name="loginfmt"], input#i0116, input[type="email"]')
    .filter({ visible: true })
    .first();
  await emailIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, emailIn);
  await humanType(s.page, email);
  await humanClickLocator(
    s.page,
    s.page
      .locator('input[type="submit"]#idSIButton9, button[type="submit"]')
      .filter({ visible: true })
      .first(),
  );
  await pageSettled(s.page);

  // 2. Password
  const pwIn = s.page
    .locator('input[name="passwd"], input#i0118, input[type="password"]')
    .filter({ visible: true })
    .first();
  await pwIn.waitFor({ state: 'visible' });
  await humanClickLocator(s.page, pwIn);
  await humanType(s.page, password);
  await humanClickLocator(
    s.page,
    s.page
      .locator('input[type="submit"]#idSIButton9, button[type="submit"]')
      .filter({ visible: true })
      .first(),
  );
  await pageSettled(s.page);

  // 3. "Stay signed in?" answered yes when Microsoft asks it.
  const staySignedIn = s.page
    .locator('input#idSIButton9')
    .filter({ visible: true })
    .first();
  if (await staySignedIn.isVisible()) {
    await humanClickLocator(s.page, staySignedIn);
    await pageSettled(s.page);
  }

  // 4. The session is confirmed on Microsoft's account page before the jar
  //    is kept: a jar from a page that never signed in is not a login.
  await s.page.goto('https://account.microsoft.com');
  await pageSettled(s.page);
  if (new URL(s.page.url()).hostname !== 'account.microsoft.com')
    throw new Error(`microsoft_session_unconfirmed: ${s.page.url()}`);
  const cookies = await s.ctx.cookies();
  const persisted = await persistFreshCookieJar(acct, cookies, {
    currentProxyUrl: proxyUrl,
    currentPersona: persona,
  });
  if (!persisted.ok)
    throw new Error(`microsoft_persist_failed: ${persisted.reason}`);
  console.log(
    `PASS: microsoft logged in (${cookies.length} cookies persisted)`,
  );
} finally {
  await s.close();
}
