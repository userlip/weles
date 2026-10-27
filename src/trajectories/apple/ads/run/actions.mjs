// The `asc ads` arguments for every Apple Ads action Weles dispatches, built
// from actions.json: the command, its required inputs (refused by their params
// name when missing), its optional values and switches, and what it changes
// (refused until the run confirms). Raw arguments and raw API requests are the
// two actions the catalog cannot describe, and are built here.
import { readFileSync } from 'node:fs';
import {
  action,
  appendPaging,
  ensureCliArgsAllowed,
  ensureConfirmed,
  payloadFile,
  requireValue,
  requireValueFrom,
  splitArgs,
  withOptional,
  withOrg,
} from './args.mjs';

const CATALOG = JSON.parse(
  readFileSync(new URL('./actions.json', import.meta.url), 'utf8'),
);

function inputArgs(key) {
  const input = CATALOG.inputs[key];
  if (!input)
    throw new Error(
      `actions.json: ${action} names input ${key}, which its inputs do not declare`,
    );
  const given = input.payload
    ? payloadFile()
    : requireValue(input.env, input.param);
  return [input.flag, requireValueFrom(given, input.param)];
}

function catalogArgs(spec) {
  if (spec.confirm) ensureConfirmed(spec.confirm);
  let args = spec.command.split(' ');
  if (spec.inputs)
    for (const key of spec.inputs.split(' ')) args.push(...inputArgs(key));
  if (spec.optional)
    for (const [flag, env] of Object.entries(spec.optional))
      args = withOptional(args, flag, env);
  if (spec.switches)
    for (const [flag, env] of Object.entries(spec.switches))
      if (process.env[env] === '1') args.push(flag);
  if (spec.confirmFlag) args.push('--confirm');
  if (spec.org !== false) args = withOrg(args);
  return spec.paging ? appendPaging(args) : args;
}

/** A raw Apple Ads API request; any method but a read is a change the run must confirm. */
function apiRequestArgs() {
  const method = requireValue('APPLE_ADS_API_METHOD', 'method').toUpperCase();
  if (method !== 'GET')
    ensureConfirmed(`send a raw ${method} Apple Ads API request`);
  const file = payloadFile();
  return withOrg([
    'ads',
    'api',
    'request',
    '--method',
    method,
    '--path',
    requireValue('APPLE_ADS_API_PATH', 'path'),
    ...(file ? ['--file', file] : []),
    // asc asks a DELETE to confirm itself.
    ...(method === 'DELETE' ? ['--confirm'] : []),
  ]);
}

export function argsForAction() {
  if (process.env.APPLE_ADS_CLI_ARGS) {
    const args = splitArgs(process.env.APPLE_ADS_CLI_ARGS);
    ensureCliArgsAllowed(args);
    return args;
  }
  if (action === 'ads_cli')
    throw new Error('apple_ads_cli requires apple_ads_cli_args');
  if (action === 'ads_api_request') return apiRequestArgs();
  if (!Object.hasOwn(CATALOG.actions, action))
    throw new Error(
      `unsupported Apple Ads action ${action}; actions.json declares the supported ones`,
    );
  return catalogArgs(CATALOG.actions[action]);
}
