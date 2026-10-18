// Create the Oxylabs ISP proxy user an ISP subscription needs before its
// addresses authenticate, and store it through the exact ISP proxy writer.
//
// The caller states the user name to request, and the entry host and ports
// the dashboard lists for the ISP product; none of them is written here.
// Oxylabs appends its own suffix to the requested name, so the created name
// is read back from the form. The credential is checked through the proxy
// before it is stored: a credential the proxy refuses is never written.
//
//   OXYLABS_ISP_USERNAME     the user name to request
//   OXYLABS_ISP_ENTRY_HOST   the ISP entry host the dashboard lists
//   OXYLABS_ISP_ENTRY_PORTS  its ports, comma separated, as the dashboard lists them

import { runOutputPath } from '#run-output';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { WSession } from '../../../../dist/session/wsession.js';
import {
  googleSso,
  getScopedGoogleLogin,
} from '../../_shared/services/google_sso.mjs';
import {
  humanIdlePause,
  humanClickLocator,
} from '../../../../dist/human/mouse.js';
import { pageCondition, urlMatching } from '../../_shared/page/settled.mjs';
import { clickOffered } from '../../_shared/page/judged/seen.mjs';
import { humanType } from '../../../../dist/human/keyboard.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import {
  assertScopedSecretWriter,
  writeScopedSecretItem,
} from '../../../_shared/scoped-secrets.mjs';
import { registrationPassword } from '../../../../dist/utils/identity/password.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';

const REQUESTED_USERNAME = statedText(
  ['OXYLABS_ISP_USERNAME'],
  'the Oxylabs ISP proxy user name to request',
);
const ENTRY_HOST = statedText(
  ['OXYLABS_ISP_ENTRY_HOST'],
  'the ISP entry host the Oxylabs dashboard lists',
);
const ENTRY_PORTS = statedText(
  ['OXYLABS_ISP_ENTRY_PORTS'],
  'the ISP entry ports the Oxylabs dashboard lists, comma separated',
);
const [PROBE_PORT] = ENTRY_PORTS.split(',').map((port) => port.trim());
// Oxylabs accepts only `_ ~ + =` as special symbols.
const ISP_PASSWORD = registrationPassword({ symbols: '_~+=' });

const OUT_DIR = runOutputPath('keeper', 'oxylabs_isp_user');
mkdirSync(OUT_DIR, { recursive: true });
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
// A screenshot is evidence for whoever reads the run; one that could not be
// taken is said with its cause instead of being logged as taken.
async function shot(s, label) {
  const fp = `${OUT_DIR}/${stamp()}_${label}.png`;
  await s.page.screenshot({ path: fp, fullPage: false }).then(
    () => console.log(`[shot] ${fp}`),
    (cause) => console.log(`[shot] ${label} not captured: ${cause.message}`),
  );
}

assertScopedSecretWriter('oxylabsIsp');
const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login)
  throw new Error(
    'oxylabs_dashboard_login_missing: Skarbiec grants no Google login for the Oxylabs dashboard',
  );

const s = await WSession.start({
  label: 'oxylabs_isp_user',
  browser: 'chromium',
});
try {
  await s.page.goto('https://dashboard.oxylabs.io/', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  const gsiFrame = s.page.frames().find((f) => /gsi\/button/.test(f.url()));
  if (!gsiFrame) {
    await shot(s, 'no_gsi');
    throw new Error(
      `oxylabs_sign_in_unavailable: no Google sign-in frame on ${s.page.url()}`,
    );
  }
  const [popup] = await Promise.all([
    s.page.waitForEvent('popup'), // allow-raw-playwright: the popup the click produces
    humanClickLocator(gsiFrame, gsiFrame.locator('div[role="button"]').first()),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  if (!(await googleSso(s, login, { originHost: 'oxylabs.io', page: popup })))
    throw new Error('oxylabs_sign_in_failed: Google SSO did not complete');
  await urlMatching(
    s.page,
    /^(?!https:\/\/dashboard\.oxylabs\.io\/en\/?(\?.*)?$)/,
  );
  console.log(`[trajectory] post-login url=${s.page.url()}`);

  await s.page.goto('https://dashboard.oxylabs.io/en/overview/ISP', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  await shot(s, 'overview_isp');

  const dismissed = await clickOffered(
    s.page,
    'a close button on a promotion that covers part of the page',
  );
  console.log(`[trajectory] promotion dismissed=${dismissed}`);

  const createBtn = s.page
    .locator(
      'button:has-text("Create proxy user"), a:has-text("Create proxy user")',
    )
    .filter({ visible: true })
    .first();
  if (!(await createBtn.isVisible())) {
    await shot(s, 'no_create_btn');
    writeFileSync(
      `${OUT_DIR}/${stamp()}_overview_text.txt`,
      await s.page.locator('body').innerText(),
    );
    throw new Error(
      `oxylabs_isp_create_unavailable: no "Create proxy user" control on ${s.page.url()}; the ISP user may already exist`,
    );
  }
  await humanClickLocator(s.page, createBtn);
  // The click opens a slide-in form or navigates; either way a username-like
  // input appears when it is ready. An input's name, id and placeholder are
  // always strings in the DOM.
  await pageCondition(s.page, () =>
    Array.from(document.querySelectorAll('input')).some(
      (el) => el.offsetParent && /user/i.test(el.name + el.id + el.placeholder),
    ),
  );
  await shot(s, 'after_create_click');
  console.log(`[trajectory] create-form url=${s.page.url()}`);

  const userIn = s.page
    .locator(
      'input[name="username"], input[name="proxyUsername"], input[id*="username" i], input[placeholder*="Username" i]',
    )
    .filter({ visible: true })
    .first();
  const passIn = s.page
    .locator(
      'input[name="password"], input[name="proxyPassword"], input[id*="password" i][type="password"], input[type="password"]',
    )
    .filter({ visible: true })
    .first();
  if (!(await userIn.isVisible()) || !(await passIn.isVisible())) {
    await shot(s, 'no_user_form');
    throw new Error(
      `oxylabs_isp_form_incomplete: the create form on ${s.page.url()} shows no username or no password field`,
    );
  }
  await userIn.click({ force: true });
  await userIn.fill('');
  await humanType(s.page, REQUESTED_USERNAME);
  await passIn.click({ force: true });
  await passIn.fill('');
  await humanType(s.page, ISP_PASSWORD);
  await humanIdlePause('short');

  const createUserBtn = s.page
    .locator('button:has-text("Create user"), button[type="submit"]')
    .filter({ visible: true })
    .last();
  if (!(await createUserBtn.isVisible()))
    throw new Error(
      `oxylabs_isp_submit_unavailable: no "Create user" control on ${s.page.url()}`,
    );
  await createUserBtn.click({ force: true });
  await humanIdlePause('long');

  // Oxylabs appends a suffix to the requested name, so the created name is
  // read back: storing the requested one would save a credential the proxy
  // refuses.
  const finalUsername = await s.page
    .locator('input[name="subuser_name"]')
    .inputValue();
  if (!finalUsername)
    throw new Error(
      `oxylabs_isp_username_unread: no subuser_name field holds the created user at ${s.page.url()}, so the credential was not stored`,
    );

  const probe = spawnSync(
    'curl',
    [
      '-s',
      '-x',
      `http://${encodeURIComponent(finalUsername)}:${encodeURIComponent(ISP_PASSWORD)}@${ENTRY_HOST}:${PROBE_PORT}`,
      'https://lumtest.com/myip.json',
    ],
    { encoding: 'utf8' },
  );
  if (probe.error)
    throw new Error(
      `oxylabs_isp_probe_failed: curl could not run to check the created credential: ${probe.error.message}`,
    );
  if (probe.status || !probe.stdout)
    throw new Error(
      `oxylabs_isp_probe_failed: curl through ${ENTRY_HOST}:${PROBE_PORT} with the created credential exited ${probe.status}: ${probe.stderr.trim()}; nothing was stored`,
    );
  console.log(
    `[trajectory] probe through ${ENTRY_HOST}:${PROBE_PORT} answered ${probe.stdout.trim()}`,
  );

  writeScopedSecretItem('oxylabsIsp', {
    username: finalUsername,
    password: ISP_PASSWORD,
    host: ENTRY_HOST,
    ports: ENTRY_PORTS,
  });
  console.log(
    '[trajectory] stored the checked ISP credential through its exact Skarbiec writer',
  );
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  process.exitCode = exitStatusFor(e);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}
