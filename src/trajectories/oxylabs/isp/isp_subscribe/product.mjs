// The ISP product page and the start of its checkout: Buy now, the stated IP
// tier, and Buy random locations.
import { writeFileSync } from 'node:fs';
import { humanIdlePause } from '../../../../../dist/human/mouse.js';
import { OUT_DIR, shot, stamp } from './evidence.mjs';

export async function openIspProduct(s) {
  // Navigate to ISP product page.
  await s.page.goto('https://dashboard.oxylabs.io/en/products', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  console.log(`[trajectory] products url=${s.page.url()}`);
  await shot(s, 'products_overview');

  // Dump page text so we know what's on screen and which selectors to try.
  const productsText = await s.page.evaluate(() => document.body.innerText);
  writeFileSync(`${OUT_DIR}/${stamp()}_products_text.txt`, productsText);
  const hasISP = /ISP\s+(Proxies|Proxy)/i.test(productsText);
  console.log(`[trajectory] products page mentions ISP: ${hasISP}`);

  // Try the direct product URL — the topup.mjs uses /overview/MP and /overview/RP,
  // so /overview/ISP is the most-likely shape. If 404, fall back to clicking
  // an ISP card on /products.
  let ispUrl = 'https://dashboard.oxylabs.io/en/overview/ISP';
  await s.page.goto(ispUrl, { waitUntil: 'domcontentloaded' });
  await humanIdlePause('long');
  console.log(`[trajectory] /overview/ISP url=${s.page.url()}`);
  await shot(s, 'overview_isp');
  const ispText = await s.page.evaluate(() => document.body.innerText);
  writeFileSync(`${OUT_DIR}/${stamp()}_overview_isp_text.txt`, ispText);
}

// `ipCount` is the tier the caller states; the page's preselection is not a
// choice anybody made.
export async function startCheckout(s, ipCount) {
  // CONFIRM mode: click Buy now (opens 3-step checkout: plan → locations → review).
  console.log('[trajectory] CONFIRM mode — clicking Buy now');
  const buyBtn = s.page
    .locator(
      'button:has-text("Buy now"), a:has-text("Buy now"), button:has-text("Buy")',
    )
    .filter({ visible: true })
    .first();
  if (!(await buyBtn.isVisible().catch(() => false))) {
    await shot(s, 'no_buy_btn');
    throw new Error('no Buy-style button visible on /overview/ISP');
  }
  await buyBtn.click({ force: true });
  await humanIdlePause('long');
  await shot(s, 'step1_choose_plan');
  console.log(`[trajectory] step1 url=${s.page.url()}`);

  // Step 1: the tier whose card names the stated IP count, selected and then
  // read back as selected; a page without that tier refuses the run.
  const tierPattern = new RegExp(`^\\s*${ipCount}\\s*IPs\\b`);
  const tier = s.page
    .locator('label, [role="radio"]')
    .filter({ hasText: tierPattern, visible: true })
    .first();
  if (!(await tier.isVisible())) {
    await shot(s, 'no_stated_tier');
    throw new Error(`the ISP checkout offers no ${ipCount} IPs tier; nothing was bought`);
  }
  await tier.click();
  const tierSelected = await tier.evaluate((el) => {
    const radio = el.matches('[role="radio"]')
      ? el
      : el.querySelector('input[type="radio"], [role="radio"]');
    return (
      radio !== null &&
      (radio.checked === true || radio.getAttribute('aria-checked') === 'true')
    );
  });
  if (!tierSelected) {
    await shot(s, 'stated_tier_not_selected');
    throw new Error(`the ${ipCount} IPs tier did not read back as selected; nothing was bought`);
  }
  console.log(`[trajectory] step1: ${ipCount} IPs tier selected`);

  // "Buy random locations" lets Oxylabs spread the IPs and advances to Stripe
  // checkout. The caller states that spread (ISP_LOCATIONS=random, read by
  // isp_subscribe.mjs); no other distribution is offered by this trajectory.
  const buyRandomBtn = s.page
    .locator('button:has-text("Buy random locations")')
    .filter({ visible: true })
    .first();
  if (!(await buyRandomBtn.isVisible().catch(() => false))) {
    await shot(s, 'no_buy_random');
    throw new Error('"Buy random locations" button not visible on step 1');
  }
  await shot(s, 'before_buy_random');
  console.log('[trajectory] clicking "Buy random locations"…');
  await buyRandomBtn.click({ force: true });
  await humanIdlePause('long');
  await shot(s, 'after_buy_random');
  console.log(`[trajectory] after buy-random url=${s.page.url()}`);
}
