// IPRoyal top-up of the stated TOPUP_USD (./sign_in.mjs). IPRoyal has no
// balance route: funds are added from the "+ Add funds" control beside the
// dashboard's balance, paid by card through Stripe Elements with the
// workspace card. The amount field must hold the stated amount before
// anything is paid, and the top-up counts once Stripe's own confirm call
// (payment or setup intent) goes out after the deposit click.
import { WSession } from '../../../dist/session/wsession.js';
import {
  fillStripeElements,
  topupOpts,
} from '../_shared/services/topup_common.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { clickDescribed, clickOffered } from '../_shared/page/judged/seen.mjs';
import {
  IPROYAL_DASHBOARD,
  IPROYAL_SESSION,
  iproyalSignIn,
} from './sign_in.mjs';

const { usd } = topupOpts();
const signIn = await iproyalSignIn();
const s = await WSession.start({
  ...IPROYAL_SESSION,
  label: 'iproyal_topup',
  browser: 'chromium',
});
try {
  await signIn(s, 'IPROYAL_TOPUP');
  await s.page.goto(IPROYAL_DASHBOARD, { waitUntil: 'domcontentloaded' });
  await pageSettled(s.page);
  await clickDescribed(s.page, 'the button that adds funds to the balance');
  await pageSettled(s.page);

  const amount = s.page
    .locator(
      'input[type="number"], input[name*="amount" i], input[inputmode="numeric"]',
    )
    .filter({ visible: true })
    .first();
  if (!(await amount.isVisible()))
    throw new Error(
      `IPROYAL_TOPUP_AMOUNT_FIELD_ABSENT: the add-funds dialog shows no amount field; nothing was charged`,
    );
  await amount.click();
  await amount.fill(String(usd));
  if (Number(await amount.inputValue()) !== usd)
    throw new Error(
      `IPROYAL_TOPUP_AMOUNT_NOT_KEPT: the amount field does not hold ${usd}; nothing was charged`,
    );

  // The card method is a styled button; choosing it surfaces Stripe's card
  // frames. A dialog already on card payment offers no such choice.
  if (
    await clickOffered(s.page, 'the payment method for a credit or debit card')
  )
    await pageSettled(s.page);
  const fill = await fillStripeElements(s.page);
  if (!fill.ok)
    throw new Error(
      `IPROYAL_TOPUP_CARD_NOT_ENTERED: ${JSON.stringify(fill)}; nothing was charged`,
    );

  let confirmed = null;
  s.ctx.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.hostname === 'api.stripe.com' &&
      /\/v1\/(?:payment_intents|setup_intents)\/[^/]+\/confirm$/.test(
        url.pathname,
      )
    )
      confirmed = url.pathname;
  });
  await clickDescribed(s.page, 'the button that pays the deposit');
  await pageSettled(s.page);
  if (!confirmed)
    throw new Error(
      `IPROYAL_TOPUP_NOT_CHARGED: the deposit was clicked but Stripe was sent no confirm call by the time the page settled (${s.page.url()})`,
    );
  console.log(
    `PASS-CHARGED: Stripe ${confirmed} was called, url=${s.page.url()}`,
  );
} finally {
  await s.close();
}
