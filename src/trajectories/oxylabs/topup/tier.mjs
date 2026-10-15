// The fixed-tier change, gated behind OXYLABS_ALLOW_TIER_CHANGE=1: the plan
// the caller names, chosen on Oxylabs's own plan page by that name, then
// Oxylabs's shared checkout (../checkout.mjs), which is bought when Stripe
// says the payment intent succeeded.
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { completeCheckout } from '../checkout.mjs';

/**
 * Move the account from `currentPlanName` to `planName`, recording each
 * checkout step through `shot`.
 */
export async function upgradeTier(s, planName, currentPlanName, shot) {
  // A monthly tier is a recurring charge, so it is committed to only when the
  // caller says so; an automatic top-up never sets this.
  if (process.env.OXYLABS_ALLOW_TIER_CHANGE !== '1')
    throw new Error(
      `current plan=${currentPlanName} but OXYLABS_ALLOW_TIER_CHANGE is not 1: refusing to commit to a recurring tier subscription`,
    );
  if (planName.toLowerCase() === currentPlanName.toLowerCase()) {
    console.log(
      `PASS-NOOP: the account is already on ${currentPlanName}; nothing was charged`,
    );
    return null;
  }
  await clickDescribed(s.page, 'the My account link in the dashboard menu');
  await clickDescribed(
    s.page,
    'the Change plan button of the current Mobile Proxies plan',
  );
  await clickDescribed(
    s.page,
    `the button that chooses the ${planName} plan among the offered plans`,
  );
  console.log(`[trajectory] CONFIRM: continuing to checkout for ${planName}`);
  await clickDescribed(s.page, 'the Continue to checkout button');
  const intent = await completeCheckout(s, shot);
  console.log(
    `PASS-CHARGED: moved from ${currentPlanName} to ${planName}; payment intent ${intent.id}`,
  );
  return intent;
}
