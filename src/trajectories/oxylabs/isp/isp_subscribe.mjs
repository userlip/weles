// Subscribe to Oxylabs ISP Proxies at the tier the caller states.
//
// Flow:
//   1. Login to dashboard.oxylabs.io via Google SSO (existing helper).
//   2. Navigate to the ISP product page.
//   3. Require ISP_BUY_CONFIRM=1 before opening the paid subscribe checkout,
//      ISP_IP_COUNT (the tier, by its number of IPs) and ISP_LOCATIONS=random
//      (the only spread this trajectory offers: Oxylabs places the IPs).
//   4. After subscription, navigate to ISP overview, scrape assigned IPs
//      into the run's keeper output as oxylabs_isp_ips.json.
//
// This script does NOT charge money unless ISP_BUY_CONFIRM=1 is set.
// Screenshots are written before each click so the caller can audit what was committed.

import { runOutputPath } from '#run-output';
import { WSession } from '../../../../dist/session/wsession.js';
import { getScopedGoogleLogin } from '../../_shared/services/google_sso.mjs';
import { loadTopupCardEnv } from '../../_shared/services/topup_common.mjs';
import { writeFileSync } from 'node:fs';
import { humanIdlePause } from '../../../../dist/human/mouse.js';
import { OUT_DIR, shot, stamp } from './isp_subscribe/evidence.mjs';
import { signInToDashboard } from './isp_subscribe/sign_in.mjs';
import { openIspProduct, startCheckout } from './isp_subscribe/product.mjs';
import { completeCheckout } from './isp_subscribe/checkout.mjs';
import { statedChoice, statedCount } from '../../_shared/inputs/stated.mjs';

// Source the card the same way every purchase trajectory does.
loadTopupCardEnv();

if (process.env.ISP_BUY_CONFIRM !== '1') {
  console.log('FAIL: ISP_BUY_CONFIRM=1 required before subscribing');
  process.exit(2);
}
const IP_COUNT = statedCount('ISP_IP_COUNT', 'the ISP tier to buy, by its number of IPs');
statedChoice(
  ['ISP_LOCATIONS'],
  Object.freeze({ random: 'Oxylabs places the IPs' }),
  'how the bought IPs are spread across locations',
);
const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login) {
  console.log('FAIL: no Google SSO creds');
  process.exit(1);
}

const s = await WSession.start({
  label: 'oxylabs_isp_subscribe',
  browser: 'chromium',
});
try {
  await signInToDashboard(s, login);
  await openIspProduct(s);
  await startCheckout(s, IP_COUNT);
  await completeCheckout(s);

  // Capture assigned IPs from /overview/ISP after subscription.
  await s.page.goto('https://dashboard.oxylabs.io/en/overview/ISP', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  await shot(s, 'isp_ip_list');
  const ipsText = await s.page.evaluate(() => document.body.innerText);
  writeFileSync(`${OUT_DIR}/${stamp()}_post_purchase_isp_text.txt`, ipsText);

  const ipMatches =
    ipsText.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g) ?? [];
  console.log(
    `[trajectory] IP-shaped strings on /overview/ISP: ${ipMatches.length} (${ipMatches.slice(0, 3).join(', ')}…)`,
  );
  if (ipMatches.length >= IP_COUNT) {
    writeFileSync(
      runOutputPath('keeper', 'oxylabs_isp_ips.json'),
      JSON.stringify(
        { captured_at: new Date().toISOString(), ips: ipMatches },
        null,
        2,
      ),
    );
    console.log(
      `[trajectory] wrote oxylabs_isp_ips.json with ${ipMatches.length} IPs`,
    );
  }
  console.log('[trajectory] done');
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  await shot(s, 'fail');
  process.exitCode = 1;
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}
