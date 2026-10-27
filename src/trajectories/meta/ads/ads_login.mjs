// Meta Ads persistent login bootstrap.
//
// Opens a visible Weles Chromium profile, waits for manual login, verifies
// the profile holds Meta's session cookies (`_shared/profile/meta_session.mjs`),
// and closes cleanly so Chrome flushes the profile. Future Meta Ads
// trajectories reuse the same profile + persona.

import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';
import {
  keptProfileDir,
  stableProfilePersona,
} from '../../_shared/profile/persona.mjs';
import { holdsMetaSession } from '../../_shared/profile/meta_session.mjs';
import { bringBrowserToFront } from '../../_shared/action/window.mjs';
import { isLoginUrl } from './session/login_wall.mjs';

const ADS_MANAGER_URL =
  'https://adsmanager.facebook.com/adsmanager/manage/campaigns';
const USER_DATA_DIR = keptProfileDir('meta_ads');

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
  await bringBrowserToFront(s, 'meta-ads-login');
  await s.goto(ADS_MANAGER_URL);
  await pageSettled(s.page);
  if (
    !(await holdsMetaSession(s.ctx, ADS_MANAGER_URL)) ||
    isLoginUrl(s.page.url())
  ) {
    console.log('[meta-ads-login] waiting for manual login in the open window');
    await bringBrowserToFront(s, 'meta-ads-login');
    await s.page.waitForURL((url) => !isLoginUrl(String(url)));
    await pageSettled(s.page);
  }
  const names = (await s.ctx.cookies(ADS_MANAGER_URL)).map((c) => c.name);
  console.log(`[meta-ads-login] cookie names: ${names.sort().join(', ')}`);
  if (!(await holdsMetaSession(s.ctx, ADS_MANAGER_URL)))
    throw new Error(
      `META_LOGIN_NOT_PERSISTED: the profile holds no c_user and xs cookies for Ads Manager (url=${s.page.url()})`,
    );
  console.log('PASS: Meta Ads login persisted');
} finally {
  await s.close();
}
