// Oxylabs's checkout for anything it sells by subscription (an ISP plan, a
// Mobile Proxies tier): the Cleverbridge steps up to Stripe, then Stripe's
// own checkout.
//
// Cleverbridge's steps (plan, payment method) are each a form; each is
// submitted through its own submit control until the browser is handed to
// checkout.stripe.com. There the shared payer (stripe/hosted_checkout.mjs)
// enters the topup card by hand, never through Link, and answers Stripe's own
// verdict on the payment: the purchase is made when Stripe says the payment
// intent succeeded, not when an address holds a success word. A step that
// offers no form to submit stops the run naming the page and its buttons.
// `shot(s, name)` records each step in the caller's evidence.
import { pageSettled } from '../_shared/page/settled.mjs';
import { CHECKOUT_HOST, payHostedCheckout } from '../stripe/hosted_checkout.mjs';
import { topupCard } from '../_shared/services/topup_common.mjs';

export async function completeCheckout(s, shot) {
  const card = topupCard();
  for (;;) {
    await pageSettled(s.page);
    const url = s.page.url();
    const at = new URL(url);
    await shot(s, `checkout${at.pathname.replace(/\W+/g, '_')}`);
    if (at.hostname === CHECKOUT_HOST) {
      const intent = await payHostedCheckout(s, { card, email: null });
      console.log(
        `[trajectory] Stripe charged the purchase: payment intent ${intent.id}; now at ${s.page.url()}`,
      );
      await shot(s, 'success');
      return intent;
    }
    const submit = s.page
      .locator('form button[type="submit"], form input[type="submit"]')
      .filter({ visible: true })
      .last();
    if (!(await submit.isVisible())) {
      const offered = await s.page
        .locator('button, [role="button"]')
        .filter({ visible: true })
        .allInnerTexts();
      throw new Error(
        `OXYLABS_CHECKOUT_STEP: ${url} offers no form to submit before Stripe; its buttons: ${offered.join(' | ')}`,
      );
    }
    console.log(`[trajectory] checkout step: submitting ${url}`);
    await submit.click();
  }
}
