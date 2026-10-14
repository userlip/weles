// AntiCaptcha topup via Google SSO. The refill page offers fixed amounts as
// buttons; the stated TOPUP_USD must be one of them. An amount the page does
// not offer is refused before anything is charged, instead of charging the
// nearest one. Clicking the amount redirects to Stripe.
import { WSession } from '../../../dist/session/wsession.js';
import {
  googleSso,
  getGoogleSsoCreds,
} from '../_shared/services/google_sso.mjs';
import { topupOpts } from '../_shared/services/topup_common.mjs';
import { humanIdlePause } from '../../../dist/human/mouse.js';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';

const { usd: amount } = topupOpts();
console.log(`[trajectory] requested $${amount}`);

const login = await getGoogleSsoCreds();
if (!login) {
  console.log('FAIL: no Google SSO creds');
  process.exit(1);
}

const s = await WSession.start({
  label: 'anticaptcha_topup',
  browser: 'chromium',
});
try {
  await s.goto('https://anti-captcha.com/clients/entrance/login');
  await humanIdlePause('deliberate');
  await s.page
    .locator(
      'button:has-text("Continue with Google"), a:has-text("Continue with Google")',
    )
    .filter({ visible: true })
    .first()
    .click();
  const ok = await googleSso(s, login, { originHost: 'anti-captcha.com' });
  if (!ok) throw new Error('Google SSO did not complete');

  await humanIdlePause('deliberate');
  await s.page.goto('https://anti-captcha.com/clients/finance/refill', {
    waitUntil: 'networkidle',
  });
  await humanIdlePause('long');

  // Click VISA card to open payment dialog
  await s.page.locator('span.card-cat:has(img[alt="Visa"])').first().click();
  await humanIdlePause('deliberate');

  // The Stripe option's own Select control, found by the vision model rather
  // than by its position among the dialog's buttons; none refuses the run.
  await clickDescribed(
    s.page,
    'the Select button of the Stripe payment option in the open payment dialog',
  );
  await humanIdlePause('deliberate');

  // The amount control whose whole text is the stated amount: a substring
  // match would take "$100" for "$10".
  const exactAmount = new RegExp(`^\\s*\\$${String(amount).replace('.', '\\.')}\\s*$`);
  const amountBtn = s.page
    .locator('button, div')
    .filter({ hasText: exactAmount, visible: true })
    .last();
  if (!(await amountBtn.isVisible()))
    throw new Error(
      `the refill page offers no $${amount} amount; nothing was charged`,
    );
  console.log(`[trajectory] found amount button $${amount}`);

  // CONFIRM: Click amount to redirect to Stripe checkout
  console.log(`[trajectory] CONFIRM: clicking $${amount} to proceed to Stripe`);
  await amountBtn.click();
  await humanIdlePause('long');

  // The amount redirects to Stripe's checkout; anything else is not a charge.
  const url = s.page.url();
  if (!/stripe\.com|checkout/i.test(url))
    throw new Error(
      `clicking $${amount} did not reach a checkout (now on ${url}); nothing was charged`,
    );
  console.log(`PASS-CHARGED: redirected to ${url} (complete payment there)`);
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
