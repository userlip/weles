// Meta Marketing API objects, reached through wisent-integrations
// (`echo-paid-ads/meta.graph.*`): the access token and the Graph version stay
// in the integrations service's `meta-ads-api` item, and a journey names only
// an object id, or an owner id and one edge.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { integrationAction } from '../../../../_shared/integrations.mjs';
import { statedText } from '../../../_shared/inputs/stated.mjs';

export { parseJsonEnv } from '../../../_shared/inputs/stated.mjs';

const INDENT = '  ';
// The number of decimal places of a US dollar amount, as ISO 4217 declares
// the currency's minor unit (read from the platform's own currency data).
const USD_MINOR_DIGITS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
}).resolvedOptions().maximumFractionDigits;

export function adAccountId() {
  const raw = statedText(
    ['AD_ACCOUNT_ID', 'META_ADS_COMPANY_ACCOUNT_ID'],
    'the Meta ad account the run acts in',
  );
  return raw.startsWith('act_') ? raw : `act_${raw.replace(/\D/g, '')}`;
}

export function submitEnabled() {
  return process.env.SUBMIT === '1';
}

/** Whether the flag `name` is set ('1', as the worker writes a true param). */
export function boolEnv(name) {
  return process.env[name] === '1';
}

export function numberEnv(name) {
  if (process.env[name] == null || process.env[name] === '') return undefined;
  const n = Number(process.env[name]);
  if (!Number.isFinite(n)) throw new Error(`${name} must be numeric`);
  return n;
}

/**
 * A US dollar amount in the account currency's minor unit (cents), which
 * Meta's monetary fields take for USD ad accounts; undefined when unstated.
 */
export function microsFromUsd(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n !== Math.abs(n))
    throw new Error(`invalid USD amount: ${value}`);
  return Math.round(Number(`${n}e${USD_MINOR_DIGITS}`));
}

/** A comma-separated list's entries, trimmed, empty ones dropped. */
export function splitList(value) {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** `obj` without its unset entries (undefined, null, empty text, empty objects). */
export function compactObject(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v === undefined || v === null || v === '') return false;
      return !(
        typeof v === 'object' &&
        !Array.isArray(v) &&
        !Object.keys(v).length
      );
    }),
  );
}

/** Graph parameters without the unset ones; the service sends each as Meta reads it. */
function graphParams(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
  );
}

/**
 * `params` as Meta validates them without creating anything, unless the run
 * submits (SUBMIT=1, or `opts.submit`) or the caller says the request does
 * not validate first (`opts.validateOnly === false`).
 */
export function withValidateOnly(params, opts) {
  const submit =
    opts && opts.submit !== undefined ? opts.submit : submitEnabled();
  const validateOnly = !(opts && opts.validateOnly === false);
  if (submit || !validateOnly) return params;
  return { ...params, execution_options: ['validate_only'] };
}

function requestEnabled(opts) {
  if (opts && opts.submit != null) return Boolean(opts.submit);
  if (opts && opts.execute != null) return Boolean(opts.execute);
  return submitEnabled();
}

/** `/id` or `/owner/edge`, as the journeys write their Graph paths. */
function graphTarget(path) {
  const [first, second, ...rest] = path.split('/').filter(Boolean);
  if (!first || rest.length)
    throw new Error(
      `Meta Graph path ${path} is neither /<id> nor /<owner>/<edge>`,
    );
  return second ? { owner_id: first, edge: second } : { id: first };
}

function graphAction(method, target) {
  if (target.id) {
    if (method === 'GET') return 'meta.graph.read';
    if (method === 'POST') return 'meta.graph.update';
    if (method === 'DELETE') return 'meta.graph.delete';
  } else {
    if (method === 'GET') return 'meta.graph.list';
    if (method === 'POST') return 'meta.graph.create';
  }
  throw new Error(
    `Meta Graph ${method} is not an action on ${JSON.stringify(target)}`,
  );
}

export async function graphRequest(method, path, params, opts) {
  if (!requestEnabled(opts))
    throw new Error('SUBMIT=1 required for Meta Marketing API request');
  const target = graphTarget(path);
  const json = await integrationAction(
    'echo-paid-ads',
    graphAction(method, target),
    {
      ...target,
      params: graphParams(params),
    },
  );
  console.log(JSON.stringify(json, null, INDENT));
  return json;
}

export async function graphUpload(path, fields, _fileField, filePath, opts) {
  if (!requestEnabled(opts))
    throw new Error('SUBMIT=1 required for Meta Marketing API upload');
  const target = graphTarget(path);
  if (!target.edge)
    throw new Error(`Meta Graph upload path ${path} names no edge`);
  const json = await integrationAction('echo-paid-ads', 'meta.graph.upload', {
    ...target,
    params: graphParams(fields),
    filename: basename(filePath),
    content_base64: readFileSync(filePath).toString('base64'),
  });
  console.log(JSON.stringify(json, null, INDENT));
  return json;
}
