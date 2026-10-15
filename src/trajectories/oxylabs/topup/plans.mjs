// Which Mobile Proxies plan the account is on, read from Oxylabs's own
// overview, and the plan a tier change moves to, stated by the caller. No
// plan names, prices or traffic allowances are written here: the page says
// what Oxylabs sells today.
import { humanIdlePause } from '../../../../dist/human/mouse.js';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { pageShows, shownText } from '../../_shared/page/judged/seen.mjs';

/** The plan a tier change moves to, by the name Oxylabs lists it under. */
export function statedPlan() {
  return statedText(
    ['OXYLABS_PLAN'],
    'the Oxylabs Mobile Proxies plan to move to, by the name Oxylabs lists it under',
  );
}

/**
 * Whether the account buys traffic pay-as-you-go, and otherwise the name of
 * its monthly plan, as the Mobile Proxies overview shows them. A plan the
 * page does not name refuses the run before anything is charged.
 */
export async function detectCurrentPlan(s) {
  await s.goto('https://dashboard.oxylabs.io/en/overview/MP', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('long');
  const isPayAsYouGo = await pageShows(
    s.page,
    'Is this Mobile Proxies account on pay-as-you-go, buying traffic by amount rather than on a monthly plan?',
  );
  if (isPayAsYouGo) {
    console.log('[trajectory] current plan: pay as you go');
    return { isPayAsYouGo, currentPlanName: null };
  }
  const currentPlanName = await shownText(
    s.page,
    'name of the monthly Mobile Proxies plan this account is on',
  );
  if (!currentPlanName)
    throw new Error(
      `OXYLABS_PLAN_UNREAD: ${s.page.url()} names no current Mobile Proxies plan; nothing was charged`,
    );
  console.log(`[trajectory] current plan=${currentPlanName}`);
  return { isPayAsYouGo, currentPlanName };
}
