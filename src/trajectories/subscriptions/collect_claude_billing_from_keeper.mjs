// Collect a Claude subscription from a verified keeper session open on
// claude.ai Settings -> Billing, through the shared keeper collector
// (./billing/collect.mjs; --session, --account, --service-credential-id).
//
// The page names the plan on a "<plan name> plan" line, with the usage line
// under it; a cancelled subscription says when it ends ("Your subscription
// will be canceled on <date>"); invoices are rows of a date, a dollar amount
// and the status Claude shows. The monthly cost is the latest paid invoice's
// amount. A page that names no plan is not the billing page and is refused.
// SUBSCRIPTION_PROVIDER states the provider as the subscription store names it.
import { statedText } from '../_shared/inputs/stated.mjs';
import { dayIn, invoiceRows, linesOf } from './billing_text.mjs';
import { runKeeperCollector } from './billing/collect.mjs';

/** Claude's invoice amounts, written in dollars. */
const AMOUNT = /^\$(?<amount>[\d.]+)$/;
/** The line naming the plan: "<plan name> plan", whatever the plan is called. */
const PLAN_LINE = /^\S+ plan$/i;
const CANCEL_LINE = /subscription will be canceled on/i;
const PAID = /^Paid$/i;

const provider = statedText(
  ['SUBSCRIPTION_PROVIDER'],
  'the provider this subscription is billed by, as the subscription store names it',
);

await runKeeperCollector({
  needsCredential: true,
  read: async (page) => {
    const lines = linesOf(await page.text());
    const planAt = lines.findIndex((line) => PLAN_LINE.test(line));
    if (planAt < 0)
      throw new Error('CLAUDE_BILLING_UNREAD: the keeper page names no "<plan> plan" line, so it is not the Claude billing page');
    const [plan, usageLine] = lines.slice(planAt);
    const cancelLine = lines.find((line) => CANCEL_LINE.test(line));
    const invoices = invoiceRows(lines, AMOUNT);
    const latestPaid = invoices.find((invoice) => PAID.test(invoice.status));
    return {
      service_name: 'Claude Code',
      provider,
      status: 'active',
      plan,
      expires_at: cancelLine ? dayIn(cancelLine) : null,
      monthly_cost_usd: latestPaid ? latestPaid.amount_usd : null,
      metadata: {
        collector: 'weles_keeper_claude_billing_ui',
        source: 'claude.ai settings billing UI',
        collected_at: new Date().toISOString(),
        usage_line: usageLine,
        cancel_line: cancelLine,
        latest_paid_invoice: latestPaid,
        invoices,
        page_lines: lines,
      },
    };
  },
});
