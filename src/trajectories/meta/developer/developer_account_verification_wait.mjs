// Open Meta developer account verification visibly and wait for the user to
// complete Meta-controlled registration/verification. Does not accept terms or
// submit phone/card data on behalf of the user. Completion is read from Meta's
// own route: the run waits until the page has left the verification and
// registration-dialog addresses, not until some words disappear.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageCondition } from '../../_shared/page/settled.mjs';

const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
mkdirSync(USER_DATA_DIR, { recursive: true });

function stableProfilePersona() {
  const p = join(USER_DATA_DIR, 'persona.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const persona = generatePersona({ os: 'macos', browser: 'chromium' });
  writeFileSync(p, JSON.stringify(persona, null, 2));
  return persona;
}

async function bringBrowserToFront(s) {
  await s.page.bringToFront().catch(() => {});
  if (process.platform !== 'darwin') return;
  spawnSync('osascript', ['-e', 'tell application "Chromium" to activate'], {
    stdio: 'ignore',
  });
  spawnSync(
    'osascript',
    [
      '-e',
      'tell application "System Events" to set frontmost of every process whose name is "Chromium" to true',
    ],
    { stdio: 'ignore' },
  );
}

const VERIFICATION_ROUTE = /account\/verification|registration\/dialog/i;

async function pageState(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    text: document.body.innerText.replace(/\s+/g, ' ').trim(),
  }));
}

console.log(
  JSON.stringify(
    {
      stage: 'start',
      userDataDir: USER_DATA_DIR,
    },
    null,
    2,
  ),
);

const s = await WSession.start({
  label: 'meta_developer_account_verification_wait',
  browser: process.env.BROWSER || 'chromium',
  proxy: process.env.PROXY_URL || 'direct',
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: false,
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  await bringBrowserToFront(s);
  await s.page.goto(
    'https://developers.facebook.com/async/developer/account/verification/',
    { waitUntil: 'domcontentloaded' },
  );
  await bringBrowserToFront(s);
  // The operator completes the registration in this window; the run waits
  // until the page has left Meta's verification and registration routes, for
  // as long as that takes, and is ended by cancellation otherwise.
  await pageCondition(
    s.page,
    (route) => !new RegExp(route, 'i').test(location.href),
    VERIFICATION_ROUTE.source,
  );
  const finalState = await pageState(s.page);
  console.log(JSON.stringify({ stage: 'final', ...finalState }, null, '  '));
  if (VERIFICATION_ROUTE.test(finalState.url)) {
    exitCode = 2;
    console.log(
      'FAIL: developer registration/verification not completed in Weles profile',
    );
  } else {
    console.log(
      'PASS: developer registration/verification flow no longer blocks this profile',
    );
  }
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
