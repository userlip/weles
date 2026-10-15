// Meta Ads CLI: create a paused campaign through Meta's official CLI.
//
// Official CLI commands follow the shape `meta ads ...`. This wrapper keeps
// Weles queue integration thin: it validates required env, invokes the CLI
// through the shared runner (`./meta_cli.mjs`), and leaves auth/token setup
// to Meta's CLI (`meta auth status`).
//
// Env:
//   CAMPAIGN_NAME        required name the campaign is listed under
//   CAMPAIGN_OBJECTIVE   required Meta objective, e.g. OUTCOME_TRAFFIC
//   DAILY_BUDGET_USD     optional daily budget
//   AD_ACCOUNT_ID        optional act_<id> / numeric account id
//   META_ADS_CLI_ARGS    optional full arg string after `meta`; when set, this
//                        bypasses the generated `ads campaign create ...` args
// The generated command creates the campaign paused.

import { statedText } from '../../../_shared/inputs/stated.mjs';
import { cliUnavailable, runMetaCommand, splitArgs } from './meta_cli.mjs';

// The campaign's name and objective are the advertiser's choices; a missing
// one refuses the run by name instead of being picked here.
const CAMPAIGN_NAME = statedText(
  ['CAMPAIGN_NAME'],
  'the name the ad account lists the campaign under',
);
const CAMPAIGN_OBJECTIVE = statedText(
  ['CAMPAIGN_OBJECTIVE'],
  'the Meta campaign objective, e.g. OUTCOME_TRAFFIC',
);
const DAILY_BUDGET_USD = process.env.DAILY_BUDGET_USD;
const AD_ACCOUNT_ID = process.env.AD_ACCOUNT_ID;
const META_ADS_CLI_ARGS = process.env.META_ADS_CLI_ARGS;

const unavailable = await cliUnavailable();
if (unavailable)
  throw new Error(
    `META_CLI_UNAVAILABLE: ${unavailable}; install Meta's Ads CLI and sign it in (meta auth status)`,
  );

await runMetaCommand(
  'meta-ads-cli',
  META_ADS_CLI_ARGS
    ? splitArgs(META_ADS_CLI_ARGS)
    : [
        'ads',
        'campaign',
        'create',
        '--name',
        CAMPAIGN_NAME,
        '--objective',
        CAMPAIGN_OBJECTIVE,
        ...(DAILY_BUDGET_USD ? ['--daily-budget', DAILY_BUDGET_USD] : []),
        ...(AD_ACCOUNT_ID ? ['--ad-account-id', AD_ACCOUNT_ID] : []),
        '--status',
        'PAUSED',
        '--output',
        'json',
      ],
);
console.log(
  `PASS: Meta Ads CLI campaign command completed for "${CAMPAIGN_NAME}"`,
);
