// The fixed-tier upgrade, gated behind OXYLABS_ALLOW_TIER_CHANGE=1: Change plan, Continue
// to checkout, the Cleverbridge and Stripe pages, and the charge observation.
import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { PLANS } from './plans.mjs';

export async function upgradeTier(s, plan, currentPlanName) {
  // Fixed-tier subscription branch — gated behind explicit OXYLABS_ALLOW_TIER_CHANGE=1
  // env var. Auto-topup cron never sets this flag, so the cron path can only
  // hit the PAYG branch above. Manual operator can run with the flag set
  // when they intentionally want to upgrade tier.
  if (process.env.OXYLABS_ALLOW_TIER_CHANGE !== '1')
    throw new Error(
      `current plan=${currentPlanName} but OXYLABS_ALLOW_TIER_CHANGE not set — refusing to commit to a recurring tier subscription from auto-context`,
    );
  const currentRank = PLANS.findIndex((p) => p.name === currentPlanName);
  const requestedRank = PLANS.findIndex((p) => p.name === plan.name);
  if (currentRank >= requestedRank) {
    console.log(
      `PASS-NOOP: current plan ${currentPlanName} is at or above requested ${plan.name} — no charge needed`,
    );
    return;
  }

  // Real tier upgrade (gated)
  await humanClickLocator(
    s.page,
    s.page.locator('a:has-text("My account")').first(),
  );
  await humanIdlePause('long');
  const changePlanBtns = await s.page
    .locator('button:has-text("Change plan"), a:has-text("Change plan")')
    .all();
  if (changePlanBtns.length === 0)
    throw new Error('no Change plan button found');
  await changePlanBtns[0].click();
  await humanIdlePause('long');
  const planIndex = requestedRank;
  const pricingBtns = await s.page
    .locator('button:has-text("Change plan")')
    .all();
  if (pricingBtns.length <= planIndex)
    throw new Error(
      `could not find Change plan button for ${plan.name} (found ${pricingBtns.length} buttons)`,
    );
  console.log(
    `[trajectory] clicking ${plan.name} Change plan button (index ${planIndex})`,
  );
  await pricingBtns[planIndex].click();
  await humanIdlePause('long');

  const continueBtn = s.page
    .locator('button:has-text("Continue to checkout")')
    .first();
  if (!(await continueBtn.isVisible().catch(() => false)))
    throw new Error('Continue to checkout button not found');
  console.log(
    `[trajectory] found Continue to checkout for ${plan.name} ($${plan.price})`,
  );

  // CONFIRM: Click Continue to checkout -> Cleverbridge/Stripe checkout page.
  // The checkout can be hosted by Cleverbridge
  // with payment-method radios (Credit Card pre-selected) + a green
  // Continue button that triggers the actual Stripe POST.
  let stripeChargeFired = false;
  s.ctx.on('request', (req) => {
    if (
      /api\.stripe\.com\/v1\/(payment_intents|setup_intents).*confirm/.test(
        req.url(),
      )
    )
      stripeChargeFired = true;
  });

  console.log(
    `[trajectory] CONFIRM: clicking Continue to checkout for ${plan.name}`,
  );
  await continueBtn.click();
  await humanIdlePause('long');

  // Now on the Cleverbridge -> Stripe checkout page. Click the second
  // Continue / payment-method continue to advance to card entry.
  const checkoutContinue = s.page
    .locator(
      'button:has-text("Continue"), input[type="submit"][value*="Continue" i]',
    )
    .filter({ visible: true })
    .last();
  if (await checkoutContinue.isVisible().catch(() => false)) {
    console.log('[trajectory] clicking Cleverbridge checkout Continue');
    await checkoutContinue.click();
    await humanIdlePause('long');
  }

  // Stripe checkout can offer Link verification. "Pay without Link" selects
  // the checkout's direct card-entry path instead.
  const payWithoutLink = s.page
    .locator(
      'button:has-text("Pay without Link"), a:has-text("Pay without Link")',
    )
    .filter({ visible: true })
    .first();
  if (await payWithoutLink.isVisible().catch(() => false)) {
    await payWithoutLink.click({ force: true });
    console.log(
      '[trajectory] clicked "Pay without Link" to bypass Stripe Link 2FA',
    );
    await humanIdlePause('deliberate');
  }

  // Probe what's actually on the page before fill.
  try {
    await s.page
      .screenshot({
        path: `${runRecordingsDir('oxylabs_topup')}/oxylabs-stripe-state.png`,
        fullPage: true,
      })
      .catch(() => {});
    await humanIdlePause('deliberate');
    for (const f of s.page.frames()) {
      try {
        const inputs = await f.evaluate(() =>
          Array.from(document.querySelectorAll('input')).map(
            (i) =>
              `${i.type || 'text'}:name=${i.name || ''}:placeholder=${i.placeholder || ''}:autocomplete=${i.autocomplete || ''}`,
          ),
        );
        const url = f.url();
        if (inputs.length)
          console.log(`[diag] frame=${url} inputs=${JSON.stringify(inputs)}`);
      } catch {}
    }
  } catch {}

  // Fill Stripe Elements card form from TOPUP_CARD_* env vars.
  const { fillStripeElements } = await import(
    '../_shared/services/topup_common.mjs'
  );
  const fill = await fillStripeElements(s.page);
  console.log(`[trajectory] stripe elements fill: ${JSON.stringify(fill)}`);
  if (!fill.ok)
    throw new Error(
      `stripe elements not fully filled: ${JSON.stringify(fill)}`,
    );

  // Stripe-hosted checkout: the final Pay button text varies (Subscribe / Pay).
  const finalBtn = s.page
    .locator(
      'button:has-text("Subscribe"), button:has-text("Pay"), button[type="submit"]',
    )
    .filter({ visible: true })
    .last();
  if (!(await finalBtn.isVisible()))
    throw new Error(
      `no Stripe-checkout submit button is visible at ${s.page.url()}; nothing was charged`,
    );
  await finalBtn.click({ force: true });
  console.log('[trajectory] clicked final Stripe-checkout submit');
  await pageSettled(s.page);

  const url = s.page.url();
  // A checkout that charged nothing has not upgraded the plan; the caller
  // turns this into FAIL and a failing exit instead of a run that succeeded.
  if (!stripeChargeFired)
    throw new Error(
      `no Stripe charge POST observed by the time the page settled, url=${url}`,
    );
  console.log(
    `PASS-CHARGED: Stripe payment_intents/confirm POST fired, url=${url}`,
  );
}
