// Subscribe to Oxylabs ISP Proxies at the tier the caller states.
//
// Flow:
//   1. Sign in to dashboard.oxylabs.io through Google SSO.
//   2. Open the ISP product page.
//   3. Require ISP_BUY_CONFIRM=1 before opening the paid subscribe checkout,
//      ISP_IP_COUNT (the tier, by its number of IPs) and ISP_LOCATIONS=random
//      (the only spread this trajectory offers: Oxylabs places the IPs), then
//      pay through Oxylabs's shared checkout (../checkout.mjs).
//   4. After the purchase, read the assigned IPs off the ISP overview into the
//      run's keeper output as oxylabs_isp_ips.json; an overview listing fewer
//      IPs than were bought fails the run with both counts.
//
// Env: PROXY_URL (required: the proxy the browser goes through, or 'direct').
// Screenshots are written before each click so the caller can audit what was
// committed.

import { runOutputPath } from '#run-output';
import { isIPv4 } from 'node:net';
import { writeFileSync } from 'node:fs';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { getScopedGoogleLogin } from '../../_shared/services/google_sso.mjs';
import { loadTopupCardEnv } from '../../_shared/services/topup_common.mjs';
import {
  statedChoice,
  statedCount,
  statedProxy,
} from '../../_shared/inputs/stated.mjs';
import { completeCheckout } from '../checkout.mjs';
import { OUT_DIR, shot, stamp } from './isp_subscribe/evidence.mjs';
import { signInToDashboard } from '../topup/sign_in.mjs';
import { openIspProduct, startCheckout } from './isp_subscribe/product.mjs';

// Source the card the same way every purchase trajectory does.
loadTopupCardEnv();

if (process.env.ISP_BUY_CONFIRM !== '1')
  throw new Error(
    'ISP_BUY_CONFIRM=1 is required before subscribing; nothing was bought',
  );
const IP_COUNT = statedCount(
  'ISP_IP_COUNT',
  'the ISP tier to buy, by its number of IPs',
);
statedChoice(
  ['ISP_LOCATIONS'],
  Object.freeze({ random: 'Oxylabs places the IPs' }),
  'how the bought IPs are spread across locations',
);
const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login)
  throw new Error(
    'the Oxylabs dashboard Google login is not in Skarbiec; nothing was bought',
  );

const s = await WSession.start({
  label: 'oxylabs_isp_subscribe',
  browser: 'chromium',
  proxy: statedProxy('the Oxylabs ISP subscription'),
});
try {
  await signInToDashboard(s, login);
  await shot(s, 'dashboard_home');
  await openIspProduct(s);
  await startCheckout(s, IP_COUNT);
  await completeCheckout(s, shot);

  // The assigned IPs, as the ISP overview lists them after the purchase.
  await s.page.goto('https://dashboard.oxylabs.io/en/overview/ISP', {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(s.page);
  await shot(s, 'isp_ip_list');
  const ipsText = await s.page.evaluate(() => document.body.innerText);
  writeFileSync(`${OUT_DIR}/${stamp()}_post_purchase_isp_text.txt`, ipsText);
  const ips = [
    ...new Set(ipsText.split(/\s+/).filter((token) => isIPv4(token))),
  ];
  if (ips.length < IP_COUNT)
    throw new Error(
      `OXYLABS_ISP_IPS_UNLISTED: the ISP overview lists ${ips.length} IPs after buying ${IP_COUNT}; see ${OUT_DIR}`,
    );
  writeFileSync(
    runOutputPath('keeper', 'oxylabs_isp_ips.json'),
    JSON.stringify({ captured_at: new Date().toISOString(), ips }, null, '  '),
  );
  console.log(`[trajectory] wrote oxylabs_isp_ips.json with ${ips.length} IPs`);
} finally {
  await s.close();
}
