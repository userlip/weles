import { pageSettled } from '../../_shared/page/settled.mjs';
import { isLoginUrl } from './session/login_wall.mjs';
// Meta Ads persistent login bootstrap.
//
// Opens a visible Weles Chromium profile, waits for manual login, verifies
// logged-in Meta cookies exist, and closes cleanly so Chrome flushes the
// profile. Future Meta Ads trajectories reuse the same profile + persona.

import { WSession } from '../../../../dist/session/wsession.js';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';

const ADS_MANAGER_URL =
  'https://adsmanager.facebook.com/adsmanager/manage/campaigns';
const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
mkdirSync(USER_DATA_DIR, { recursive: true });

async function bringBrowserToFront(s) {
  await s.page.bringToFront();
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

/** The names of the cookies Ads Manager would be sent. */
async function adsManagerCookieNames(s) {
  const cookies = await s.ctx.cookies(ADS_MANAGER_URL);
  return new Set(cookies.map((c) => c.name));
}

/** Meta's signed-in session is its c_user and xs cookies together. */
function signedIn(names) {
  return names.has('c_user') && names.has('xs');
}

console.log(
  `[meta-ads-login] profile=${USER_DATA_DIR} viewport=${process.env.WELES_VIEWPORT}`,
);
const s = await WSession.start({
  label: 'meta_ads_login',
  proxy: statedProxy('the Meta Ads login'),
  persona: stableProfilePersona(USER_DATA_DIR),
  userDataDir: USER_DATA_DIR,
});

try {
  await bringBrowserToFront(s);
  await s.goto(ADS_MANAGER_URL);
  await pageSettled(s.page);
  if (!signedIn(await adsManagerCookieNames(s)) || isLoginUrl(s.page.url())) {
    console.log('[meta-ads-login] waiting for manual login in the open window');
    await bringBrowserToFront(s);
    await s.page.waitForURL((url) => !isLoginUrl(String(url)));
    await pageSettled(s.page);
  }
  const names = await adsManagerCookieNames(s);
  console.log(
    `[meta-ads-login] cookie names: ${Array.from(names).sort().join(', ')}`,
  );
  if (!signedIn(names))
    throw new Error(
      `META_LOGIN_NOT_PERSISTED: the profile holds no c_user and xs cookies for Ads Manager (url=${s.page.url()})`,
    );
  console.log('PASS: Meta Ads login persisted');
} finally {
  await s.close();
}
