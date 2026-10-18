// Reset Oxylabs proxy-user passwords and replace only their exact
// dedicated Skarbiec items. Missing read/write grants block before login.
import { WSession } from '../../../dist/session/wsession.js';
import {
  googleSso,
  getScopedGoogleLogin,
} from '../_shared/services/google_sso.mjs';
import {
  humanIdlePause,
  humanClickLocator,
} from '../../../dist/human/mouse.js';
import { responseAfterAction, urlMatching } from '../_shared/page/settled.mjs';
import { clickOffered } from '../_shared/page/judged/seen.mjs';
import { humanType } from '../../../dist/human/keyboard.js';
import {
  assertScopedSecretWriter,
  readScopedProxy,
  readScopedSecret,
  writeScopedSecretItem,
} from '../../_shared/scoped-secrets.mjs';
import { registrationPassword } from '../../../dist/utils/identity/password.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';

/** The calls a dashboard's script sends, as the browser classes them. */
const SCRIPT_CALLS = { fetch: true, xhr: true };
// Oxylabs accepts only `_ ~ + =` as special symbols.
function generatePassword() {
  return registrationPassword({ symbols: '_~+=' });
}

const mobileProxy = readScopedProxy('oxylabsMobile');
const dedicatedIspProxy = {
  ...readScopedProxy('oxylabsDedicatedIsp'),
  host: readScopedSecret('oxylabsDedicatedIsp', 'host'),
  ports: readScopedSecret('oxylabsDedicatedIsp', 'ports'),
};
const ispProxy = {
  ...readScopedProxy('oxylabsIsp'),
  host: readScopedSecret('oxylabsIsp', 'host'),
  ports: readScopedSecret('oxylabsIsp', 'ports'),
};
for (const serviceName of [
  'oxylabsMobile',
  'oxylabsDedicatedIsp',
  'oxylabsIsp',
]) {
  assertScopedSecretWriter(serviceName);
}

// Without the dashboard login nothing is opened: the refusal names the login
// the run looked for, before any browser starts.
const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login)
  throw new Error(
    'OXYLABS_DASHBOARD_LOGIN_MISSING: no scoped Google SSO login is granted for oxylabsDashboard, so the dashboard cannot be signed into',
  );
console.log(`[reset] Using Google SSO: ${login.email}`);

const s = await WSession.start({
  label: 'oxylabs_reset_passwords',
  browser: 'chromium',
});
const results = [];

try {
  await s.goto('https://dashboard.oxylabs.io/');
  await humanIdlePause('long');

  const gsiFrame = s.page.frames().find((f) => /gsi\/button/.test(f.url()));
  if (!gsiFrame) throw new Error('no GSI iframe');
  const popupPromise = s.page.waitForEvent('popup');
  await humanClickLocator(
    s.page,
    gsiFrame.locator('div[role="button"]').first(),
  );
  const popup = await popupPromise;
  if (!popup) throw new Error('popup did not open');
  await popup.waitForLoadState('domcontentloaded');

  const ok = await googleSso(s, login, {
    originHost: 'oxylabs.io',
    page: popup,
  });
  if (!ok) throw new Error('Google SSO did not complete');

  await urlMatching(
    s.page,
    /^(?!https:\/\/dashboard\.oxylabs\.io\/en\/?(\?.*)?$)/,
  );
  console.log(`[reset] post-login url=${s.page.url()}`);

  async function resetPassword({ usersUrl, product, serviceName, current }) {
    const username = current.username;
    console.log(`[reset] starting ${product}`);
    try {
      await s.page.goto(usersUrl, { waitUntil: 'domcontentloaded' });
      await humanIdlePause('long');

      // The control that edits this proxy user, as the page offers it in the
      // user's row; a page without one is recorded, not guessed at.
      const edited = await clickOffered(
        s.page,
        `the control in the row of proxy user ${username} that edits the user or changes its password`,
      );
      console.log(`[reset] ${product} edit control offered=${edited}`);
      if (!edited) {
        results.push({ product, status: 'edit_button_not_found' });
        return;
      }
      await humanIdlePause('long');

      // The dashboard renders the password field as either type="password" or
      // type="text" with name="password" (plaintext when showing the generated
      // password). Target the visible password input by name/placeholder.
      const passInput = s.page
        .locator(
          'input[type="password"], input[type="text"][name="password"], input[placeholder*="password" i]',
        )
        .filter({ visible: true })
        .first();
      const passVisible = await passInput.isVisible();
      console.log(`[reset] ${product} password input visible=${passVisible}`);
      if (!passVisible) {
        results.push({ product, status: 'no_password_input' });
        return;
      }

      const newPassword = generatePassword();
      await passInput.fill('');
      await passInput.fill(newPassword);
      await humanIdlePause('short');

      // Submit the form the password field belongs to, and read Oxylabs'
      // own answer to the change it sends: the dashboard's first script call
      // that writes. Its status is the verdict, not words on the page.
      const answer = await responseAfterAction(
        s.page,
        (request) =>
          request.method() !== 'GET' &&
          Object.hasOwn(SCRIPT_CALLS, request.resourceType()),
        () => passInput.press('Enter'),
      );
      // Without Oxylabs accepting it the new password exists only here;
      // storing it would replace a working credential with one never set.
      // A refusal whose body cannot be read fails this product with that
      // read's cause, through the catch below.
      if (!answer.ok()) {
        const said = await answer.text();
        results.push({
          product,
          status: 'refused',
          answer: { status: answer.status(), url: answer.url(), body: said },
        });
        console.log(
          `[reset] ${product} Oxylabs refused the change: ${answer.status()} ${answer.url()} ${said}`,
        );
        return;
      }
      const status = 'password_set';
      writeScopedSecretItem(serviceName, {
        ...current,
        password: newPassword,
      });
      results.push({ product, status });
      console.log(`[reset] ${product} done status=${status}`);
    } catch (e) {
      console.log(`[reset] ${product} err: ${e.message || String(e)}`);
      results.push({ product, status: 'error', error: e.message });
    }
  }

  await resetPassword({
    usersUrl: 'https://dashboard.oxylabs.io/en/overview/MP/users',
    product: 'mobile',
    serviceName: 'oxylabsMobile',
    current: mobileProxy,
  });
  await resetPassword({
    usersUrl: 'https://dashboard.oxylabs.io/en/overview/dedicated-isp/users',
    product: 'dedicated_isp',
    serviceName: 'oxylabsDedicatedIsp',
    current: dedicatedIspProxy,
  });
  await resetPassword({
    usersUrl: 'https://dashboard.oxylabs.io/en/overview/ISP/users',
    product: 'isp',
    serviceName: 'oxylabsIsp',
    current: ispProxy,
  });

  console.log('Results:');
  for (const r of results) {
    console.log(`  ${r.product}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
  }
  // A product whose password was not set keeps its old credential; the run
  // says which ones instead of ending as if every reset went through.
  const unset = results.filter((r) => r.status !== 'password_set');
  if (unset.length)
    throw new Error(
      `oxylabs_password_reset_incomplete: ${unset.map((r) => `${r.product}=${r.status}`).join(', ')}`,
    );
} catch (e) {
  console.log('FAIL:', e.message || String(e));
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close();
}
