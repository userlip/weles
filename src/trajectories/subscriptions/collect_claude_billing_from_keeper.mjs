// Collect Claude subscription metadata from a verified Weles keeper UI.
//
// Expected UI:
//   claude.ai -> Settings -> Billing
//   "Max plan"
//   "Your subscription will be canceled on Jul 7, 2026."
//   invoice rows like "Jun 7, 2026  $200  Paid"
//
// This reads UI text from a keeper session that was verified interactively
// first. It does not call provider billing APIs and it does not run a fresh
// login trajectory.

import { keeperRequest, keeperSocket } from '../_shared/keeper/client.mjs';
import { upsertSubscription } from '../../lib/service_subscriptions.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { dayIn, invoiceRows, linesOf } from './billing_text.mjs';

/** Claude's invoice amounts, written in dollars. */
const AMOUNT = /^\$(?<amount>[\d.]+)$/;
/** The line naming the plan: "<plan name> plan", whatever the plan is called. */
const PLAN_LINE = /^\S+ plan$/i;
/** The provider as the subscription store names it, stated by the caller. */
const PROVIDER = statedText(
  ['SUBSCRIPTION_PROVIDER'],
  'the provider this subscription is billed by, as the subscription store names it',
);

function parseArgs() {
  const out = {
    session: process.env.SESSION || '',
    account: process.env.SUBSCRIPTION_ACCOUNT || '',
    serviceCredentialId: '',
  };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === '--session') out.session = process.argv[++i] || '';
    else if (arg === '--account')
      out.account = process.argv[++i] || out.account;
    else if (arg === '--service-credential-id')
      out.serviceCredentialId = process.argv[++i] || out.serviceCredentialId;
    else throw new Error(`unknown arg: ${arg}`);
  }
  if (!out.session) throw new Error('missing --session or SESSION');
  if (!out.account.trim())
    throw new Error(
      'missing --account or SUBSCRIPTION_ACCOUNT: the account the subscription is billed to',
    );
  if (!out.serviceCredentialId.trim())
    throw new Error(
      'missing --service-credential-id: the credential for this subscription account',
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

function parseInvoices(lines) {
  return invoiceRows(lines, AMOUNT);
}

function extractBilling(text) {
  const lines = linesOf(text);
  const billingIdx = lines.findIndex((line) => line === 'Billing');
  const planIdx = lines.findIndex((line) => PLAN_LINE.test(line));
  const plan = planIdx >= 0 ? lines[planIdx] : null;
  const usageLine = planIdx >= 0 ? lines[planIdx + 1] || null : null;
  const cancelLine = lines.find((line) =>
    /subscription will be canceled on/i.test(line),
  );
  const expiresAt = cancelLine ? parseHumanDate(cancelLine) : null;
  const invoices = parseInvoices(lines);
  const latestPaid =
    invoices.find((item) => /^Paid$/i.test(item.status)) || null;
  const monthlyCost = latestPaid?.amount_usd ?? null;
  return {
    service_name: 'Claude Code',
    provider: PROVIDER,
    status: plan ? 'active' : 'unknown',
    plan,
    expires_at: expiresAt,
    monthly_cost_usd: monthlyCost,
    metadata: {
      collector: 'weles_keeper_claude_billing_ui',
      source: 'claude.ai settings billing UI',
      collected_at: new Date().toISOString(),
      usage_line: usageLine,
      cancel_line: cancelLine || null,
      latest_paid_invoice: latestPaid,
      invoices,
      ui_excerpt: lines.slice(
        Math.max(0, billingIdx),
        billingIdx >= 0 ? billingIdx + 44 : 90,
      ),
    },
  };
}

async function main() {
  const args = parseArgs();
  const text = await readText(args.session);
  if (!/Billing/i.test(text) || !/(Invoices|Payment|plan)/i.test(text)) {
    throw new Error('keeper page does not look like Claude billing UI');
  }
  const collected = extractBilling(text);
  const row = {
    ...collected,
    account_identifier: args.account,
    service_credential_id: args.serviceCredentialId,
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
          invoice_rows: row.metadata.invoices.length,
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
