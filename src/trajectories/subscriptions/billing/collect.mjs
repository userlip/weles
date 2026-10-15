// One subscription collection from a keeper session that was signed in to
// the provider and verified interactively first: the collector reads the
// provider's billing pages through the keeper (it calls no billing API and
// runs no login), its provider reader turns them into a subscription row, the
// row is written to the subscription store, and the row and what the store
// kept are printed as one JSON answer. A refusal is thrown and sets the exit
// status from its error.
//
// Inputs: --session (or SESSION), the keeper session; --account (or
// SUBSCRIPTION_ACCOUNT), the account the subscription is billed to; and, for
// a collector that records the account's credential, --service-credential-id.
// A missing one is refused by name before the keeper is asked anything.
import { parseArgs } from 'node:util';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { keeperRequest, keeperSocket } from '../../_shared/keeper/client.mjs';
import { upsertSubscription } from '../../../lib/service_subscriptions.mjs';

const INDENT = '  ';

function collectorInputs(needsCredential) {
  const options = { session: { type: 'string' }, account: { type: 'string' } };
  if (needsCredential) options['service-credential-id'] = { type: 'string' };
  const { values } = parseArgs({ options });
  const session = values.session ? values.session : process.env.SESSION;
  const account = values.account ? values.account : process.env.SUBSCRIPTION_ACCOUNT;
  if (!session) throw new Error('missing --session or SESSION');
  if (!account || !account.trim())
    throw new Error('missing --account or SUBSCRIPTION_ACCOUNT: the account the subscription is billed to');
  const credential = values['service-credential-id'];
  if (needsCredential && (!credential || !credential.trim()))
    throw new Error('missing --service-credential-id: the credential for this subscription account');
  return { session, account, credential };
}

/** The keeper session's page, as the provider readers use it. */
function keeperPage(session) {
  const ask = async (command) => {
    const answer = await keeperRequest(keeperSocket(session), command);
    if (!answer.ok)
      throw new Error(`KEEPER_ACTION_REFUSED: ${command.action} answered ${answer.error ? answer.error : JSON.stringify(answer)}`);
    return answer;
  };
  return {
    /** The page's visible text. */
    async text() {
      const answer = await ask({ action: 'eval', js: 'document.body.innerText' });
      if (typeof answer.result !== 'string') throw new Error(`KEEPER_PAGE_UNREAD: the page's text read as ${JSON.stringify(answer.result)}`);
      return answer.result;
    },
    async open(url) {
      await ask({ action: 'nav', url });
      await ask({ action: 'settle' });
    },
    /** Clicks the visible control whose whole text is `label`, as the provider labels it. */
    async clickLabelled(label) {
      const target = await ask({
        action: 'eval',
        js: `(() => {
          const wanted = ${JSON.stringify(label)};
          for (const el of document.querySelectorAll('button,a,[role=button],[role=tab],div,span')) {
            if (el.innerText.trim() !== wanted || !el.checkVisibility()) continue;
            const box = el.getBoundingClientRect();
            // A person's click lands anywhere inside the control.
            if (box.width && box.height) return { x: box.x + box.width * Math.random(), y: box.y + box.height * Math.random() };
          }
          return null;
        })()`,
      });
      if (!target.result) throw new Error(`KEEPER_CONTROL_MISSING: the page shows no control labelled "${label}"`);
      await ask({ action: 'humanclick', x: target.result.x, y: target.result.y });
      await ask({ action: 'settle' });
    },
  };
}

/**
 * @param {object} collector
 * @param {boolean} collector.needsCredential whether the row records --service-credential-id
 * @param {(page: ReturnType<typeof keeperPage>) => Promise<object>} collector.read the provider's
 *   reader: the subscription row's service_name, provider, status, plan, expires_at,
 *   monthly_cost_usd and metadata, from the keeper's pages
 */
export async function runKeeperCollector(collector) {
  try {
    const inputs = collectorInputs(collector.needsCredential);
    const collected = await collector.read(keeperPage(inputs.session));
    const row = {
      ...collected,
      account_identifier: inputs.account,
      ...(collector.needsCredential ? { service_credential_id: inputs.credential } : {}),
      last_verified_at: new Date().toISOString(),
    };
    const saved = await upsertSubscription(row);
    const { metadata, ...summary } = row;
    console.log(
      JSON.stringify(
        {
          ok: true,
          row: { ...summary, collector: metadata.collector },
          saved: saved.map(({ metadata: kept, ...item }) => item),
        },
        null,
        INDENT,
      ),
    );
  } catch (error) {
    console.error(error.stack);
    process.exitCode = exitStatusFor(error);
  }
}

/** The sum of `amounts` (US dollars, at least one), to the cent. */
export function centsTotal(amounts) {
  const cents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).resolvedOptions()
    .maximumFractionDigits;
  return Number(amounts.reduce((sum, amount) => sum + amount).toFixed(cents));
}
