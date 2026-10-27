// Pay a Stripe-hosted Checkout Session with the workspace topup card.
//
// Stripe refuses raw card numbers over its API — "Sending credit card numbers
// directly to the Stripe API is generally unsafe" — so a hosted checkout can
// only be completed the way a person completes it: in a browser, on
// checkout.stripe.com. The completion itself is stripe/hosted_checkout.mjs,
// shared with every provider flow that hands the browser to Stripe; this
// trajectory runs it for a session URL it is given, without knowing any
// provider.
//
// Inputs:
//   STRIPE_CHECKOUT_URL   the https://checkout.stripe.com/c/pay/cs_... page
//   STRIPE_PAY_CONFIRM=1  required: this spends real money
//   TOPUP_CARD_*          card: TOPUP_CARD_JSON, the host's topup_card.env, or the environment
//   STRIPE_PAY_NAME       optional cardholder name override
//   STRIPE_PAY_EMAIL      contact email the hosted page requires
//
// Output: PASS-CHARGED naming the succeeded payment intent and the final URL,
// or FAIL with the reason Stripe or the page gave, exiting with that
// failure's status. Screenshots land in the session directory at every
// decision point, because a refused card and a refused form look identical in
// a log.

import { WSession } from '../../../dist/session/wsession.js';
import {
  loadTopupCardEnv,
  topupCard,
} from '../_shared/services/topup_common.mjs';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { CHECKOUT_HOST, payHostedCheckout } from './hosted_checkout.mjs';

// One loader, so this works wherever the card is kept; no card at all is refused.
console.log(`[stripe-checkout] card source: ${loadTopupCardEnv()}`);

let s = null;
try {
  const url = process.env.STRIPE_CHECKOUT_URL;
  if (typeof url !== 'string' || new URL(url).hostname !== CHECKOUT_HOST)
    throw new Error(
      `STRIPE_CHECKOUT_URL must be a https://${CHECKOUT_HOST}/ session page; it is ${JSON.stringify(url)}`,
    );
  if (process.env.STRIPE_PAY_CONFIRM !== '1')
    throw new Error('STRIPE_PAY_CONFIRM=1 is required before charging a card');
  const card = topupCard();
  const stated = process.env.STRIPE_PAY_EMAIL;
  const email =
    typeof stated === 'string' && stated.trim() !== '' ? stated.trim() : null;
  s = await WSession.start({
    label: 'stripe_pay_checkout',
    browser: 'chromium',
  });
  await s.goto(url);
  const intent = await payHostedCheckout(s, { card, email });
  console.log(
    `PASS-CHARGED: payment intent ${intent.id} succeeded; final url=${s.page.url()}`,
  );
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = exitStatusFor(e);
} finally {
  if (s !== null) await s.close();
}
