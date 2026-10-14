// The Oxylabs Mobile Proxies plans, the one a tier change was asked for, and
// reading which plan the account is on.
import { humanIdlePause } from '../../../../dist/human/mouse.js';
import { statedText } from '../../_shared/inputs/stated.mjs';

// Oxylabs Mobile Proxies plans, in the order Oxylabs ranks them.
export const PLANS = [
  { name: 'Starter', price: 30, gb: 4 },
  { name: 'Basic', price: 100, gb: 15 },
  { name: 'Standard', price: 270, gb: 45 },
  { name: 'Advanced', price: 500, gb: 100 },
];

// The plan a tier change moves to is stated by name (OXYLABS_PLAN); it is
// never picked as the one priced nearest to an amount.
export function statedPlan() {
  const name = statedText(
    ['OXYLABS_PLAN'],
    `the Oxylabs plan to move to, one of ${PLANS.map((p) => p.name).join(', ')}`,
  );
  const plan = PLANS.find((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!plan)
    throw new Error(
      `OXYLABS_PLAN is "${name}", not one of ${PLANS.map((p) => p.name).join(', ')}; nothing was charged`,
    );
  return plan;
}

export async function detectCurrentPlan(s) {
  // Distinguish recurring monthly subscriptions from pay-as-you-go credit
  // purchases through the page-level
  // "Add more traffic" button. Auto-topup must use the PAYG path only —
  // tier subscriptions are recurring monthly charges that the user must
  // commit to explicitly. Fixed-tier upgrade lives in this file as a
  // separate branch but is gated to never run from auto-cron context.
  // The plan is read from this page; one that did not open is no plan.
  await s.goto('https://dashboard.oxylabs.io/en/overview/MP', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  const planText = await s.page.evaluate(() => document.body.innerText);
  const isPayAsYouGo =
    /Current plan\s*\|?\s*Pay as you go/i.test(planText) ||
    /\bPay as you go\b/i.test(planText);
  let currentPlanName = isPayAsYouGo ? 'Pay as you go' : null;
  if (!currentPlanName) {
    for (const p of PLANS) {
      if (
        new RegExp(
          `\\b${p.name}\\b\\s*(Plan|\\$${p.price}|/mo|month)`,
          'i',
        ).test(planText)
      ) {
        currentPlanName = p.name;
        break;
      }
    }
  }
  if (!currentPlanName)
    throw new Error(
      'could not detect current Oxylabs plan from /overview/MP — refusing to charge with unknown state',
    );
  console.log(`[trajectory] current plan=${currentPlanName}`);
  return { isPayAsYouGo, currentPlanName };
}
