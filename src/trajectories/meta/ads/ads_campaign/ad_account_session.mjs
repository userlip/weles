// Whose session this is and which ad account it is pointed at.
//
// Three questions live here: is the browser showing a login or checkpoint
// address instead of Ads Manager, did a human finish logging in while we
// waited, and is the account on screen the one the run named. The last one is
// a refusal, not a warning: a draft built in the wrong ad account spends
// somebody else's money. The account Ads Manager opened is the `act`
// parameter of its address; its name is read off the page by the vision
// model. Every refusal is thrown with its cause.

import { pageSettled } from '../../../_shared/page/settled.mjs';
import { shownText } from '../../../_shared/page/judged/seen.mjs';
import { bringBrowserToFront as raiseWindow } from '../../../_shared/action/window.mjs';
import {
  AD_ACCOUNT_ID,
  AD_ACCOUNT_NAME,
  BUSINESS_ID,
  WAIT_FOR_LOGIN,
  targetUrl,
} from './campaign_request.mjs';
import { isLoginUrl, isSecurityWall } from '../session/login_wall.mjs';

const ADS_MANAGER_CAMPAIGNS =
  'https://adsmanager.facebook.com/adsmanager/manage/campaigns';

function bringBrowserToFront(s) {
  return raiseWindow(s, 'meta-ads');
}

/** Returns only when Ads Manager is on screen; anything else is refused. */
async function passLoginGate(s) {
  if (isLoginUrl(s.page.url())) {
    if (!WAIT_FOR_LOGIN)
      throw new Error(
        `META_ADS_NOT_SIGNED_IN: the Facebook session is signed out or checkpointed (${s.page.url()}) and WAIT_FOR_LOGIN is not set`,
      );
    console.log('[meta-ads] waiting for manual login in the open window');
    await bringBrowserToFront(s);
    await s.page.waitForURL((u) => !isLoginUrl(String(u)));
    await s.goto(targetUrl);
    await pageSettled(s.page);
  }
  // Meta's security and two-factor steps live at their own addresses.
  if (isSecurityWall(s.page.url()))
    throw new Error(
      `META_ADS_SECURITY_VERIFICATION: the Meta account requires security verification (${s.page.url()})`,
    );
}

/** The ad account Ads Manager's address names, without `act_`, or null. */
function currentAdAccountId(url) {
  const act = new URL(url).searchParams.get('act');
  return act ? act.replace(/^act_/, '') : null;
}

/** The account Ads Manager has open: its id from the address, its name by sight. */
async function visibleSelectedAdAccount(s) {
  return {
    id: currentAdAccountId(s.page.url()),
    label: await shownText(
      s.page,
      'name of the ad account Ads Manager has selected',
    ),
  };
}

async function ensureAdAccount(s) {
  const before = currentAdAccountId(s.page.url());
  console.log(
    `[meta-ads] current ad account=${before ? before : 'not in the address'} target=${AD_ACCOUNT_ID ? AD_ACCOUNT_ID : 'not stated'}`,
  );
  if (!AD_ACCOUNT_ID) return before;

  if (before !== AD_ACCOUNT_ID) {
    const url = new URL(ADS_MANAGER_CAMPAIGNS);
    url.searchParams.set('act', AD_ACCOUNT_ID);
    if (BUSINESS_ID) url.searchParams.set('business_id', BUSINESS_ID);
    console.log(`[meta-ads] switching ad account -> ${AD_ACCOUNT_ID}`);
    await s.goto(url.toString());
    await pageSettled(s.page);
  }
  const visible = await visibleSelectedAdAccount(s);
  console.log(
    `[meta-ads] ad account after switch=${visible.id} name=${JSON.stringify(visible.label)}`,
  );
  if (visible.id !== AD_ACCOUNT_ID)
    throw new Error(
      `META_ADS_WRONG_ACCOUNT: Ads Manager opened account ${visible.id} instead of ${AD_ACCOUNT_ID} (url=${s.page.url()})`,
    );
  if (
    AD_ACCOUNT_NAME &&
    !(
      visible.label &&
      visible.label.toLowerCase().includes(AD_ACCOUNT_NAME.toLowerCase())
    )
  )
    throw new Error(
      `META_ADS_WRONG_ACCOUNT: the selected account reads ${JSON.stringify(visible.label)}, not ${JSON.stringify(AD_ACCOUNT_NAME)}`,
    );
  return visible.id;
}

export {
  bringBrowserToFront,
  ensureAdAccount,
  passLoginGate,
  visibleSelectedAdAccount,
};
