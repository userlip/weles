// Re-scrape the existing ISP proxy-user's full username and reset its
// password to capture both. Used after isp_create_user.mjs fails to capture
// the auto-suffix Oxylabs appends to the username.

import { WSession } from '../../../../dist/session/wsession.js';
import {
  googleSso,
  getScopedGoogleLogin,
} from '../../_shared/services/google_sso.mjs';
import { spawnSync } from 'node:child_process';
import {
  humanIdlePause,
  humanClickLocator,
} from '../../../../dist/human/mouse.js';
import { urlMatching } from '../../_shared/page/settled.mjs';
import { humanType } from '../../../../dist/human/keyboard.js';
import {
  assertScopedSecretWriter,
  writeScopedSecretItem,
} from '../../../_shared/scoped-secrets.mjs';
import { exitStatusFor } from '../../../../dist/cli/usage.js';

const rand = (n) =>
  Array.from(
    { length: n },
    () =>
      'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
  ).join('');
const NEW_PASSWORD = `${rand(8)}Aa1_${rand(3)}`;

assertScopedSecretWriter('oxylabsIsp');
const login = await getScopedGoogleLogin('oxylabsDashboard');
const s = await WSession.start({
  label: 'oxylabs_isp_reset',
  browser: 'chromium',
});
try {
  await s.page.goto('https://dashboard.oxylabs.io/', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  const gsiFrame = s.page.frames().find((f) => /gsi\/button/.test(f.url()));
  if (!gsiFrame) throw new Error('no GSI iframe');
  const popupP = s.page.waitForEvent('popup').catch(() => null);
  await humanClickLocator(
    gsiFrame,
    gsiFrame.locator('div[role="button"]').first(),
  );
  const popup = await popupP; // allow-raw-playwright: the popup the click produced
  await popup?.waitForLoadState('domcontentloaded').catch(() => {});
  if (!(await googleSso(s, login, { originHost: 'oxylabs.io', page: popup })))
    throw new Error('Google SSO did not complete');
  await urlMatching(
    s.page,
    /^(?!https:\/\/dashboard\.oxylabs\.io\/en\/?(\?.*)?$)/,
  );

  await s.page.goto('https://dashboard.oxylabs.io/en/overview/ISP', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');

  // 1. Read all visible text — find the existing proxy user name (full, with suffix).
  const text = await s.page.evaluate(
    () => (document.body && document.body.innerText) || '',
  );
  // Look for "wisentisp..." pattern with optional _XXX suffix
  const userMatch = text.match(/\bwisentisp\w+\b/);
  const fullUsername = userMatch ? userMatch[0] : null;
  // Checked before the password is reset: a reset whose credential cannot be
  // stored would leave the user with a password nobody holds.
  if (!fullUsername)
    throw new Error(
      `oxylabs_isp_username_unread: no wisentisp user name on ${s.page.url()}, so the password was not reset`,
    );

  // Also try to read input[name="username"] / specific fields if present
  const inputs = await s.page.evaluate(() =>
    Array.from(document.querySelectorAll('input'))
      .filter((i) => i.offsetParent)
      .map((i) => ({
        name: i.name,
        id: i.id,
        type: i.type,
        ph: i.placeholder,
      })),
  );
  console.log(
    `[trajectory] visible input descriptors: ${JSON.stringify(inputs)}`,
  );

  // 2. Click "Generate new password" or similar to refresh credentials.
  const genButtons = s.page
    .locator('button, a')
    .filter({ hasText: /generate|reset|new password|change password/i });
  const genCount = await genButtons.count().catch(() => 0);
  const genButton = genButtons.first();
  const genText = genCount
    ? ((await genButton.textContent().catch(() => '')) || '').trim()
    : '';
  const genClicked = genCount
    ? await humanClickLocator(s.page, genButton)
        .then(() => true)
        .catch(() => false)
    : false;
  const genResult = { ok: genClicked, count: genCount, txt: genText };
  console.log(`[trajectory] gen-password click: ${JSON.stringify(genResult)}`);
  await humanIdlePause('deliberate');

  // If a password input becomes editable, type the new password.
  const passInputs = await s.page.evaluate(() =>
    Array.from(document.querySelectorAll('input'))
      .filter(
        (i) =>
          i.offsetParent &&
          (i.type === 'password' ||
            /password/i.test(i.name + i.id + i.placeholder)),
      )
      .map((i) => ({ name: i.name, id: i.id })),
  );
  console.log(
    `[trajectory] password input count after reset action: ${passInputs.length}`,
  );

  // The new password is stored only once Oxylabs has taken it: a password
  // Oxylabs never set, stored in Skarbiec, is a credential the proxy refuses.
  if (!passInputs.length)
    throw new Error(
      `oxylabs_isp_password_field_missing: no password field after the reset action at ${s.page.url()}`,
    );
  const pwLoc = s.page
    .locator('input[name="password"], input[type="password"]:not([readonly])')
    .filter({ visible: true })
    .first();
  await pwLoc.click({ force: true });
  await pwLoc.fill('');
  await humanType(s.page, NEW_PASSWORD);
  console.log(
    `[trajectory] typed new password (length ${NEW_PASSWORD.length})`,
  );
  const confirmBtn = s.page
    .locator(
      'button:has-text("Save"), button:has-text("Confirm"), button:has-text("Update"), button:has-text("Set"), button[type="submit"]',
    )
    .filter({ visible: true })
    .last();
  await confirmBtn.click({ force: true });
  await humanIdlePause('long');

  writeScopedSecretItem('oxylabsIsp', {
    username: fullUsername,
    password: NEW_PASSWORD,
    host: 'isp.oxylabs.io',
    ports: Array.from({ length: 10 }, (_, index) => String(8001 + index)).join(
      ',',
    ),
  });
  console.log(
    '[trajectory] stored reset ISP credential through its exact Skarbiec writer',
  );
  // A credential the proxy refuses fails the run instead of printing done.
  const probe = spawnSync(
    'curl',
    [
      '-s',
      '-x',
      `http://${encodeURIComponent(fullUsername)}:${encodeURIComponent(NEW_PASSWORD)}@isp.oxylabs.io:8001`,
      'https://lumtest.com/myip.json',
    ],
    { encoding: 'utf8' },
  );
  if (probe.error)
    throw new Error(
      `oxylabs_isp_probe_failed: curl could not run to check the stored credential: ${probe.error.message}`,
    );
  if (probe.status || !probe.stdout)
    throw new Error(
      `oxylabs_isp_probe_failed: curl through isp.oxylabs.io:8001 with the reset credential exited ${probe.status}: ${probe.stderr.trim()}`,
    );
  console.log('[trajectory] done');
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close().catch(() => {});
}
