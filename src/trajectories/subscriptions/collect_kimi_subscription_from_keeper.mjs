// Collect a Kimi Code subscription from a verified keeper session signed in to
// kimi.com, through the shared keeper collector (./billing/collect.mjs;
// --session, --account, --service-credential-id).
//
// The membership page names the plan on the line before Kimi's own "Upgrade
// Plan" control and the renewal on its "Next auto-renewal date:" line, with
// the plan's benefits after "Basic Benefits". Its "Billing & Invoices" tab
// lists invoices as rows of a date, a dollar amount and the status Kimi shows;
// the monthly cost is the largest paid invoice on the latest invoiced date.
// Its "My Quota" tab gives the total usage, the reset time, a gift quota and
// the recent Kimi Code usage rows (a timestamp and a percentage). A page
// without the Upgrade Plan control names no plan and is refused.
import { dayIn, invoiceRows, linesOf } from './billing_text.mjs';
import { runKeeperCollector } from './billing/collect.mjs';

const MEMBERSHIP = 'https://www.kimi.com/membership/subscription';
/** Kimi's invoice amounts, written in dollars. */
const AMOUNT = /^\$(?<amount>[\d.]+)$/;
const PAID = /^Paid$/i;
const RENEWAL_LINE = /^Next auto-renewal date:/i;
const RESET_LINE = /^Reset time:/i;
const GIFT_EXPIRY_LINE = /^Expires on/i;
const USAGE_AT = /^\d+-\d+-\d+\s+\d+:\d+:\d+$/;
const PERCENT = /^\d+(?:\.\d+)?%$/;

/** The line after the one that is exactly `label`; undefined when there is none. */
function after(lines, label) {
  const [, next] = lines.slice(lines.indexOf(label));
  return lines.includes(label) ? next : undefined;
}

function membership(lines) {
  const upgradeAt = lines.indexOf('Upgrade Plan');
  if (upgradeAt < 0) throw new Error('KIMI_SUBSCRIPTION_UNREAD: the membership page shows no Upgrade Plan control, so it names no plan');
  const [plan] = lines.toSpliced(upgradeAt).reverse();
  const renewalLine = lines.find((line) => RENEWAL_LINE.test(line));
  const benefitsAt = lines.indexOf('Basic Benefits');
  const [, ...benefits] = benefitsAt < 0 ? [] : lines.slice(benefitsAt);
  return { plan, renewalLine, benefits: benefits.filter((line) => line !== 'Cancel Plan') };
}

function quota(lines) {
  const usageRows = [];
  for (const [index] of lines.entries()) {
    const [label, at, percentage] = lines.slice(index);
    if (label === 'Kimi Code' && USAGE_AT.test(at) && PERCENT.test(percentage)) usageRows.push({ service: label, at, percentage });
  }
  // The page lists two "Total usage" blocks: the plan's quota, then the gift's.
  const planUsageAt = lines.indexOf('Total usage');
  const giftUsageAt = lines.lastIndexOf('Total usage');
  const resetLine = lines.find((line) => RESET_LINE.test(line));
  const giftExpiryLine = lines.find((line) => GIFT_EXPIRY_LINE.test(line));
  return {
    total_usage_percent: after(lines, 'Total usage'),
    reset_at: resetLine ? dayIn(resetLine) : null,
    gift_usage_percent: giftUsageAt > planUsageAt ? after(lines.slice(giftUsageAt), 'Total usage') : undefined,
    gift_expires_at: giftExpiryLine ? dayIn(giftExpiryLine) : null,
    recent_usage: usageRows,
    page_lines: lines,
  };
}

/** The largest paid invoice on the latest date any invoice was paid; null when none is paid. */
function currentPlanCost(invoices) {
  const paid = invoices.filter((invoice) => PAID.test(invoice.status));
  const [latest] = paid.map((invoice) => invoice.date).toSorted().reverse();
  const onLatest = paid.filter((invoice) => invoice.date === latest).map((invoice) => invoice.amount_usd);
  return onLatest.length ? Math.max(...onLatest) : null;
}

await runKeeperCollector({
  needsCredential: true,
  read: async (page) => {
    await page.open(MEMBERSHIP);
    const membershipLines = linesOf(await page.text());
    const info = membership(membershipLines);
    await page.clickLabelled('Billing & Invoices');
    const billingLines = linesOf(await page.text());
    const invoices = invoiceRows(billingLines, AMOUNT);
    await page.clickLabelled('My Quota');
    const usage = quota(linesOf(await page.text()));
    const monthlyCost = currentPlanCost(invoices);
    return {
      service_name: 'Kimi Code',
      provider: 'moonshot',
      status: 'active',
      plan: info.plan,
      expires_at: info.renewalLine ? dayIn(info.renewalLine) : null,
      monthly_cost_usd: monthlyCost,
      metadata: {
        collector: 'weles_keeper_kimi_subscription_ui',
        source: 'kimi.com membership subscription UI',
        collected_at: new Date().toISOString(),
        renewal_line: info.renewalLine,
        monthly_cost_basis: 'largest paid invoice on latest invoice date in Billing & Invoices UI',
        benefits: info.benefits,
        invoices,
        quota: usage,
        page_lines: { subscription_info: membershipLines, billing: billingLines },
      },
    };
  },
});
