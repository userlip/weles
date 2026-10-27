// Collect a ChatGPT (Codex) subscription from a verified keeper session open
// on chatgpt.com Settings -> Billing, through the shared keeper collector
// (./billing/collect.mjs; --session, --account).
//
// The page names the plan on its "ChatGPT <plan>" line; a cancelled plan says
// when it ends ("Your plan will be canceled on <date>"); the billing history
// is rows of a date, a US$ amount and the status ChatGPT shows. The monthly
// cost is the sum of the paid invoices in the latest invoiced month. A page
// that names no ChatGPT plan is not the billing page and is refused.
// SUBSCRIPTION_PROVIDER states the provider as the subscription store names it.
import { statedText } from '../_shared/inputs/stated.mjs';
import { dayIn, invoiceRows, linesOf } from './billing_text.mjs';
import { centsTotal, runKeeperCollector } from './billing/collect.mjs';

/** ChatGPT's billing history amounts, written in US dollars. */
const AMOUNT = /^US\$(?<amount>[\d.]+)$/;
const PLAN_LINE = /^ChatGPT\s+\S/;
const CANCEL_LINE = /Your plan will be canceled on/i;
const PAID = /^Paid$/i;
const MONTH = /^\d+-\d+/;

const provider = statedText(
  ['SUBSCRIPTION_PROVIDER'],
  'the provider this subscription is billed by, as the subscription store names it',
);

/** The paid invoices of the latest month any invoice was paid in. */
function latestPaidMonth(history) {
  const paid = history.filter((invoice) => PAID.test(invoice.status));
  const monthOf = (invoice) => {
    const [month] = invoice.date.match(MONTH);
    return month;
  };
  const [latest] = paid.map(monthOf).toSorted().reverse();
  return paid.filter((invoice) => monthOf(invoice) === latest);
}

await runKeeperCollector({
  needsCredential: false,
  read: async (page) => {
    const lines = linesOf(await page.text());
    const plan = lines.find((line) => PLAN_LINE.test(line));
    if (!plan)
      throw new Error(
        'CHATGPT_BILLING_UNREAD: the keeper page names no "ChatGPT <plan>" line, so it is not the ChatGPT billing page',
      );
    const cancelLine = lines.find((line) => CANCEL_LINE.test(line));
    const history = invoiceRows(lines, AMOUNT);
    const month = latestPaidMonth(history);
    return {
      service_name: 'Codex',
      provider,
      status: 'active',
      plan,
      expires_at: cancelLine ? dayIn(cancelLine) : null,
      monthly_cost_usd: month.length
        ? centsTotal(month.map((invoice) => invoice.amount_usd))
        : null,
      metadata: {
        collector: 'weles_keeper_chatgpt_billing_ui',
        source: 'chatgpt.com settings billing UI',
        collected_at: new Date().toISOString(),
        cancel_line: cancelLine,
        monthly_cost_basis:
          'sum of paid Billing history invoices in the latest invoice month',
        latest_paid_invoices: month,
        billing_history: history,
        page_lines: lines,
      },
    };
  },
});
