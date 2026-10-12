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
import { urlMatching } from '../_shared/page/settled.mjs';
import { humanType } from '../../../dist/human/keyboard.js';
import {
  assertScopedSecretWriter,
  readScopedProxy,
  readScopedSecret,
  writeScopedSecretItem,
} from '../../_shared/scoped-secrets.mjs';
import { registrationPassword } from '../../../dist/utils/identity/password.js';

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

const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login) {
  console.log('FAIL: no Google SSO creds');
  process.exit(1);
}
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

      // Click "Edit user" / "Change password" for the known username.
      const editBtn = s.page
        .locator('tr')
        .filter({ hasText: username })
        .locator('button, a')
        .filter({ hasText: /Edit user|Change password/i })
        .first();
      const editVisible = await editBtn.isVisible().catch(() => false);
      console.log(`[reset] ${product} edit/change visible=${editVisible}`);
      if (!editVisible) {
        results.push({ product, status: 'edit_button_not_found' });
        return;
      }
      await editBtn.waitFor({ state: 'visible' });
      await humanClickLocator(s.page, editBtn);
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
      const passVisible = await passInput.isVisible().catch(() => false);
      console.log(`[reset] ${product} password input visible=${passVisible}`);
      if (!passVisible) {
        results.push({ product, status: 'no_password_input' });
        return;
      }

      const newPassword = generatePassword();
      await passInput.fill('');
      await passInput.fill(newPassword);
      await humanIdlePause('short');

      // Save/Submit. The dedicated-ISP modal uses "Change password" / "Submit
      // changes"; the mobile modal uses "Submit changes". Click the last
      // visible submit-ish button, but avoid "Generate password".
      const saveBtn = s.page
        .locator('button')
        .filter({
          hasText:
            /^(Save|Submit|Update|Confirm|Submit changes|Change password)$/i,
        })
        .filter({ visible: true })
        .last();
      // Without a save the new password exists only here; storing it would
      // replace a working credential with one Oxylabs never set.
      if (!(await saveBtn.isVisible())) {
        results.push({ product, status: 'save_button_not_found' });
        return;
      }
      await saveBtn.click({ force: true });
      await humanIdlePause('deliberate');

      // Verify success toast. Oxylabs shows "Success!" + "Your user has been
      // updated successfully!" or "Password changed for user <username>".
      const bodyText = await s.page.evaluate(() => document.body.innerText);
      const hasSuccess = /success|updated successfully|password changed/i.test(
        bodyText,
      );
      const hasError =
        /error|failed|incorrect|invalid|weak password|must contain/i.test(
          bodyText,
        );
      const status =
        hasSuccess && !hasError
          ? 'password_set'
          : hasError
            ? 'possible_error'
            : 'unknown';
      if (status === 'password_set') {
        writeScopedSecretItem(serviceName, {
          ...current,
          password: newPassword,
        });
      }
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
  process.exitCode = 1;
} finally {
  await s.close();
}
