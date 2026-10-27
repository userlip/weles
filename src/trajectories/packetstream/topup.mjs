// PacketStream topup.
// PacketStream's /dashboard/deposit offers fixed deposit amounts in its own
// dropdown. The stated TOPUP_USD must be one of the amounts that dropdown
// lists, read from the page; any other amount is refused before anything is
// charged, instead of charging the next amount up. Choosing the amount hands
// the page to the payment provider, off PacketStream's own origin. A missing
// login, a refused sign-in or a dropdown that does not leave PacketStream
// fails the run with its cause.
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { getServiceLogin } from '../../../dist/utils/credentials.js';
import { WSession } from '../../../dist/session/wsession.js';
import { topupOpts } from '../_shared/services/topup_common.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

const PACKETSTREAM_ORIGIN = 'https://app.packetstream.io';

async function signIn(s, login) {
  await s.goto(`${PACKETSTREAM_ORIGIN}/login`);
  await pageSettled(s.page);
  const username = s.page
    .locator('input[name="username"]')
    .filter({ visible: true })
    .first();
  await username.click();
  await username.pressSequentially(login.email);
  const password = s.page
    .locator('input[name="password"]')
    .filter({ visible: true })
    .first();
  await password.click();
  await password.pressSequentially(login.password);
  await password.press('Enter');
  await pageSettled(s.page);
  if (/\/login/.test(s.page.url()))
    throw new Error(`packetstream_login_refused (still on ${s.page.url()})`);
}

async function deposit(s, usd) {
  await s.page.goto(`${PACKETSTREAM_ORIGIN}/dashboard/deposit`, {
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
  // navigates to the payment provider; the page it lands on settles before
  // it is read.
  await s.page.selectOption('#paypal-amount', String(usd));
  console.log(`[trajectory] selected $${usd}`);
  await pageSettled(s.page);
  const finalUrl = s.page.url();
  console.log(`[trajectory] post-submit url=${finalUrl}`);
  if (new URL(finalUrl).origin === PACKETSTREAM_ORIGIN)
    throw new Error(
      `the deposit dropdown left the page on PacketStream (${finalUrl}) instead of the payment provider`,
    );
  return finalUrl;
}

try {
  const { usd } = topupOpts();
  const login = await getServiceLogin('PacketStream');
  if (!login)
    throw new Error(
      'PACKETSTREAM_LOGIN_UNAVAILABLE: Skarbiec holds no PacketStream login',
    );
  const s = await WSession.start({
    label: 'packetstream_topup',
    browser: 'chromium',
  });
  try {
    await signIn(s, login);
    const checkout = await deposit(s, usd);
    console.log(
      `PASS-CHARGED-PENDING: redirected to checkout (${checkout}). The payment provider completes the $${usd} charge against the saved payment method; packetstream/balance.mjs reads the result.`,
    );
  } finally {
    await s.close();
  }
} catch (error) {
  console.log(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
}
