// PacketStream topup.
// PacketStream's /dashboard/deposit offers fixed deposit amounts in its own
// dropdown. The stated TOPUP_USD must be one of the amounts that dropdown
// lists, read from the page; any other amount is refused before anything is
// charged, instead of charging the next amount up.
import { getServiceLogin } from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { topupOpts } from '../_shared/services/topup_common.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

const { usd } = topupOpts();

const login = await getServiceLogin('PacketStream');
if (!login) {
  console.log('FAIL: no PacketStream creds');
  process.exit(1);
}

const s = await WSession.start({
  label: 'packetstream_topup',
  browser: 'chromium',
});
try {
  await s.goto('https://app.packetstream.io/login');
  await pageSettled(s.page);
  const u = s.page
    .locator('input[name="username"]')
    .filter({ visible: true })
    .first();
  await u.click();
  await u.pressSequentially(login.email);
  const p = s.page
    .locator('input[name="password"]')
    .filter({ visible: true })
    .first();
  await p.click();
  await p.pressSequentially(login.password);
  await p.press('Enter');
  await pageSettled(s.page);
  if (/\/login/.test(s.page.url()))
    throw new Error(`packetstream_login_refused (still on ${s.page.url()})`);

  await s.page.goto('https://app.packetstream.io/dashboard/deposit', {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(s.page);
  const offered = await s.page
    .locator('#paypal-amount option')
    .evaluateAll((options) =>
      options.map((option) => option.value).filter(Boolean),
    );
  if (!offered.includes(String(usd)))
    throw new Error(
      `PacketStream offers deposits of ${JSON.stringify(offered)} USD, not ${usd}; nothing was charged`,
    );
  // Selecting the amount fires the dropdown's change handler, which
  // redirects to the payment provider.
  await s.page.selectOption('#paypal-amount', String(usd));
  console.log(`[trajectory] selected $${usd}`);
  // The change handler navigates to the payment provider; the page that
  // navigation lands on settles before it is read.
  await pageSettled(s.page);
  const finalUrl = s.page.url();
  console.log(`[trajectory] post-submit url=${finalUrl}`);
  if (!/paypal\.com|stripe\.com|checkout/i.test(finalUrl))
    throw new Error(
      `dropdown change did not redirect to a checkout URL (${finalUrl}). PacketStream may have changed its flow; revisit selectors.`,
    );
  console.log(
    `PASS-CHARGED-PENDING: redirected to checkout (${finalUrl}). PayPal/Stripe will complete the $${usd} charge against the saved payment method. Verify via PacketStream's "Recent Payments" or by re-running src/trajectories/packetstream/balance.mjs.`,
  );
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
