// Meta Ads CLI: update an existing campaign.
//
// Env:
//   CAMPAIGN_ID         required unless META_ADS_CLI_ARGS is set
//   ADS_URL             optional existing Ads Manager draft/editor URL, edited in the
//                       browser (ads_campaign.mjs) when the Meta CLI is unavailable
//   CAMPAIGN_NAME       optional new name
//   STATUS              optional PAUSED | ACTIVE | ARCHIVED | DELETED
//   DAILY_BUDGET_USD    optional budget value if supported by installed CLI
//   AD_ACCOUNT_ID       optional act_<id> / numeric account id
//   META_ADS_CLI_ARGS   optional full arg string after `meta`; bypasses generated args
//   SUBMIT              must be "1" to set ACTIVE. Other updates are allowed.
//
// The update runs through Meta's official CLI (`./cli/meta_cli.mjs`). When the
// CLI is unavailable and ADS_URL is stated, the browser campaign trajectory
// edits that draft and its exit is this run's; otherwise the unavailable CLI
// is refused with its cause.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliUnavailable, runMetaCommand, splitArgs } from './cli/meta_cli.mjs';

const CAMPAIGN_ID = process.env.CAMPAIGN_ID;
const ADS_URL = process.env.ADS_URL;
const CAMPAIGN_NAME = process.env.CAMPAIGN_NAME;
const STATUS = process.env.STATUS;
const DAILY_BUDGET_USD = process.env.DAILY_BUDGET_USD;
const AD_ACCOUNT_ID = process.env.AD_ACCOUNT_ID;
const META_ADS_CLI_ARGS = process.env.META_ADS_CLI_ARGS;
const SUBMIT = process.env.SUBMIT === '1';

if (!META_ADS_CLI_ARGS && !CAMPAIGN_ID && !ADS_URL)
  throw new Error('CAMPAIGN_ID, ADS_URL, or META_ADS_CLI_ARGS required');
if (STATUS && /^active$/i.test(STATUS) && !SUBMIT)
  throw new Error('refusing to activate campaign without SUBMIT=1');

/** Edit ADS_URL in the browser campaign trajectory; its failure is this run's. */
async function browserUpdate() {
  const script = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'ads_campaign.mjs',
  );
  const code = await new Promise((done, fail) => {
    const child = spawn(process.execPath, [script], {
      stdio: 'inherit',
      env: { ...process.env, ADS_URL, SUBMIT: SUBMIT ? '1' : '0' },
    });
    child.on('error', fail);
    child.on('close', done);
  });
  if (code)
    throw new Error(
      `META_ADS_BROWSER_UPDATE_FAILED: ads_campaign.mjs exited ${code} for ${ADS_URL}`,
    );
}

const unavailable = await cliUnavailable();
if (unavailable && ADS_URL) {
  console.log(
    `[meta-ads-update] ${unavailable}; editing the draft in the browser via ads_campaign.mjs`,
  );
  await browserUpdate();
} else if (unavailable) {
  throw new Error(
    `META_CLI_UNAVAILABLE: ${unavailable}, and no ADS_URL names a draft to edit in the browser`,
  );
} else {
  await runMetaCommand(
    'meta-ads-update',
    META_ADS_CLI_ARGS
      ? splitArgs(META_ADS_CLI_ARGS)
      : [
          'ads',
          'campaign',
          'update',
          CAMPAIGN_ID,
          ...(CAMPAIGN_NAME ? ['--name', CAMPAIGN_NAME] : []),
          ...(STATUS ? ['--status', STATUS.toUpperCase()] : []),
          ...(DAILY_BUDGET_USD ? ['--daily-budget', DAILY_BUDGET_USD] : []),
          ...(AD_ACCOUNT_ID ? ['--ad-account-id', AD_ACCOUNT_ID] : []),
          '--output',
          'json',
        ],
  );
}
console.log(
  `PASS: Meta Ads campaign update completed${CAMPAIGN_ID ? ` (${CAMPAIGN_ID})` : ''}`,
);
