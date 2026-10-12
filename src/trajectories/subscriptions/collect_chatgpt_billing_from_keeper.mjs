// Collect ChatGPT/Codex subscription metadata from a verified Weles keeper UI.
//
// Expected UI:
//   ChatGPT settings -> Billing
//   "ChatGPT Pro 20x"
//   "Your plan will be canceled on Jul 7, 2026"
//   "Billing history ..."
//
// This reads UI text from a keeper session that was verified interactively
// first. It does not call provider billing APIs and it does not run a fresh
// login trajectory.

import { keeperRequest, keeperSocket } from '../_shared/keeper/client.mjs';
import { upsertSubscription } from '../../lib/service_subscriptions.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { dayIn, invoiceRows, linesOf } from './billing_text.mjs';

/** ChatGPT's billing history amounts, written in US dollars. */
const AMOUNT = /^US\$(?<amount>[\d.]+)$/;
/** The provider as the subscription store names it, stated by the caller. */
const PROVIDER = statedText(
  ['SUBSCRIPTION_PROVIDER'],
  'the provider this subscription is billed by, as the subscription store names it',
);

function parseArgs() {
  const out = {
    session: process.env.SESSION || '',
    account: process.env.SUBSCRIPTION_ACCOUNT || '',
  };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--session') out.session = process.argv[++i] || '';
    else if (arg === '--account')
      out.account = process.argv[++i] || out.account;
    else throw new Error(`unknown arg: ${arg}`);
  }
  if (!out.session) throw new Error('missing --session or SESSION');
  if (!out.account)
    throw new Error(
      'missing --account or SUBSCRIPTION_ACCOUNT: the account the subscription is billed to',
    );
  return out;
}

async function action(session, cmd) {
  const answer = await keeperRequest(keeperSocket(session), cmd);
  if (!answer.ok)
    throw new Error(answer.error || `keeper action failed: ${cmd.action}`);
  return answer;
}

async function readText(session) {
  const result = await action(session, {
    action: 'eval',
    js: 'document.body.innerText',
  });
  return String(result.result || '');
}

function parseHumanDate(value) {
  return dayIn(value);
}

function parseBillingHistory(lines) {
  return invoiceRows(lines, AMOUNT);
}

function latestPaidMonthTotal(history) {
  const paid = history.filter((item) => /^Paid$/i.test(item.status));
  if (!paid.length) return null;
  const latestMonth = paid
    .map((item) => item.date.slice(0, 7))
    .sort()
    .at(-1);
  const total = paid
    .filter((item) => item.date.startsWith(latestMonth))
    .reduce((sum, item) => sum + item.amount_usd, 0);
  return Math.round(total * 100) / 100;
}

function extractBilling(text) {
  const lines = linesOf(text);
  const billingIdx = lines.findIndex(
    (line, idx) => line === 'Billing' && lines[idx + 1]?.startsWith('ChatGPT '),
  );
  const plan =
    billingIdx >= 0
      ? lines[billingIdx + 1]
      : lines.find((line) => /^ChatGPT\s+/i.test(line)) || null;
  const cancelLine = lines.find((line) =>
    /Your plan will be canceled on/i.test(line),
  );
  const expiresAt = cancelLine ? parseHumanDate(cancelLine) : null;
  const billingHistory = parseBillingHistory(lines);
  const latestPaid =
    billingHistory.find((item) => /^Paid$/i.test(item.status)) || null;
  const latestPaidMonthCost = latestPaidMonthTotal(billingHistory);
  return {
    service_name: 'Codex',
    provider: PROVIDER,
    status: expiresAt ? 'active' : plan ? 'active' : 'unknown',
    plan,
    expires_at: expiresAt,
    monthly_cost_usd: latestPaidMonthCost,
    metadata: {
      collector: 'weles_keeper_chatgpt_billing_ui',
      source: 'chatgpt.com settings billing UI',
      collected_at: new Date().toISOString(),
      cancel_line: cancelLine || null,
      monthly_cost_basis:
        latestPaidMonthCost == null
          ? null
          : 'sum of paid Billing history invoices in the latest invoice month',
      latest_paid_invoice: latestPaid,
      billing_history: billingHistory,
      ui_excerpt: lines.slice(
        Math.max(0, billingIdx),
        billingIdx >= 0 ? billingIdx + 40 : 80,
      ),
    },
  };
}

async function main() {
  const args = parseArgs();
  const text = await readText(args.session);
  if (!/Billing/i.test(text) || !/ChatGPT/i.test(text)) {
    throw new Error('keeper page does not look like ChatGPT billing UI');
  }
  const collected = extractBilling(text);
  const row = {
    ...collected,
    account_identifier: args.account,
    last_verified_at: new Date().toISOString(),
  };
  const saved = await upsertSubscription(row);
  console.log(
    JSON.stringify(
      {
        ok: true,
        row: {
          service_name: row.service_name,
          provider: row.provider,
          account_identifier: row.account_identifier,
          status: row.status,
          plan: row.plan,
          monthly_cost_usd: row.monthly_cost_usd,
          expires_at: row.expires_at,
          billing_history_rows: row.metadata.billing_history.length,
        },
        saved: saved.map((item) => ({
          id: item.id,
          service_name: item.service_name,
          provider: item.provider,
          account_identifier: item.account_identifier,
          status: item.status,
          plan: item.plan,
          monthly_cost_usd: item.monthly_cost_usd,
          expires_at: item.expires_at,
          last_verified_at: item.last_verified_at,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
