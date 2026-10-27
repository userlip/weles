// The pay-as-you-go top-up: Add more traffic, the whole GB the stated budget
// buys at the price the purchase dialog states, the non-refundable
// acknowledgement, and the Stripe card form. Throws when any step or the
// charge fails.
//
// The per-GB price is read from the dialog, never written here, and the GB
// count is the budget divided by it, rounded down so the charge never
// exceeds the budget; a budget below one GB is refused. The amount is set
// through the dialog's own increase control and read back before anything
// is paid. The purchase is made when Stripe's confirm request goes out.
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import {
  clickDescribed,
  shownAmount,
  shownText,
} from '../../_shared/page/judged/seen.mjs';
import { fillStripeElements } from '../../_shared/services/topup_common.mjs';

/** The GB of traffic the purchase dialog has selected, as it prints it. */
async function selectedGb(page) {
  const shown = await shownText(
    page,
    'number of GB of traffic the purchase dialog has selected, as a number alone',
  );
  const gb = Number(shown);
  if (!shown || !Number.isFinite(gb))
    throw new Error(
      `OXYLABS_PAYG_AMOUNT_UNREAD: the purchase dialog's selected amount reads ${JSON.stringify(shown)}; nothing was charged`,
    );
  return gb;
}

/** Tick the dialog's non-refundable acknowledgement and read it back. */
async function acknowledgeNonRefundable(page) {
  const box = page.locator('input[name="nonrefundableCondition"]').first();
  if (!(await box.count()))
    throw new Error(
      `OXYLABS_PAYG_ACKNOWLEDGEMENT: ${page.url()} shows no non-refundable acknowledgement; nothing was charged`,
    );
  // The input is hidden behind its styled label, which takes the click.
  if (!(await box.isChecked()))
    await humanClickLocator(page, page.locator('label', { has: box }).first());
  if (!(await box.isChecked()))
    throw new Error(
      'OXYLABS_PAYG_ACKNOWLEDGEMENT: the non-refundable acknowledgement did not read back as ticked; nothing was charged',
    );
}

export async function topUpPayAsYouGo(s, usd) {
  console.log('[trajectory] pay-as-you-go account: buying traffic by amount');
  await clickDescribed(s.page, 'the Add more traffic button');
  const gbPrice = await shownAmount(
    s.page,
    'price of one GB of traffic in the purchase dialog',
  );
  if (!gbPrice)
    throw new Error(
      `OXYLABS_PAYG_PRICE_UNREAD: the purchase dialog at ${s.page.url()} states no per-GB price; nothing was charged`,
    );
  const targetGb = Math.floor(usd / gbPrice);
  if (!targetGb)
    throw new Error(
      `the budget $${usd} buys no whole GB at $${gbPrice}/GB; nothing was bought`,
    );
  console.log(
    `[trajectory] buying ${targetGb} GB at $${gbPrice}/GB (total $${targetGb * gbPrice} of budget $${usd})`,
  );
  const startGb = await selectedGb(s.page);
  if (startGb > targetGb)
    throw new Error(
      `OXYLABS_PAYG_AMOUNT: the dialog starts at ${startGb} GB, above the ${targetGb} GB the budget buys; nothing was charged`,
    );
  for (const step of Array(targetGb - startGb).keys()) {
    await clickDescribed(
      s.page,
      'the control that increases the GB of traffic in the purchase dialog',
    );
    console.log(
      `[trajectory] increased the amount after ${step} earlier steps of ${targetGb - startGb}`,
    );
  }
  const chosenGb = await selectedGb(s.page);
  if (chosenGb !== targetGb)
    throw new Error(
      `OXYLABS_PAYG_AMOUNT: the dialog reads ${chosenGb} GB after stepping to ${targetGb}; nothing was charged`,
    );
  await acknowledgeNonRefundable(s.page);

  let stripeConfirmed = false;
  s.ctx.on('request', (req) => {
    const url = new URL(req.url());
    if (url.hostname === 'api.stripe.com' && url.pathname.endsWith('/confirm'))
      stripeConfirmed = true;
  });
  console.log(`[trajectory] CONFIRM: continuing to pay for ${targetGb} GB`);
  await clickDescribed(s.page, 'the Continue button of the purchase dialog');
  const fill = await fillStripeElements(s.page);
  if (!fill.ok)
    throw new Error(
      `the Stripe card form was not filled: ${JSON.stringify(fill)}; nothing was charged`,
    );
  await clickDescribed(s.page, 'the button that pays for the traffic');
  await pageSettled(s.page);
  if (!stripeConfirmed)
    throw new Error(
      `no Stripe confirm request went out by the time the page settled at ${s.page.url()}`,
    );
  console.log(
    `PASS-CHARGED: Stripe confirmed the payment for ${targetGb} GB at $${gbPrice}/GB ($${targetGb * gbPrice})`,
  );
}
