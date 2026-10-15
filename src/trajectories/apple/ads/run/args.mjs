// The environment an Apple Ads action arrives as, and the helpers that turn it
// into `asc ads` arguments. A missing input, and an unconfirmed change, is
// refused by name; nothing is assumed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../../dist/session/run-recordings.js';
import { statedText } from '../../../_shared/inputs/stated.mjs';

// `asc` on PATH unless ASC_BIN names the binary.
export const ASC_BIN = process.env.ASC_BIN ? process.env.ASC_BIN : 'asc';
export const action = statedText(['APPLE_ADS_ACTION'], 'the Apple Ads verb the run performs (the action name after apple_)');
export const org = process.env.ASC_ADS_ORG_ID;
export const adsProfile = process.env.APPLE_ADS_PROFILE_NAME;
export const confirmed =
  process.env.APPLE_ADS_CONFIRM === '1' || process.env.WRITE_CONFIRM === '1' || process.env.SUBMIT === '1';

/** The input `name`, or undefined when it is unset or empty. */
export function value(name) {
  const v = process.env[name];
  return v ? v : undefined;
}

/** The input `name`, refused by its `label` (its own name when none) when missing. */
export function requireValue(name, label) {
  return requireValueFrom(value(name), label ? label : name);
}

export function requireValueFrom(v, label) {
  if (!v) throw new Error(`${label} is required for ${action}`);
  return v;
}

export function withOrg(args) {
  let out = args;
  if (org) out = [...out, '--org', org];
  if (adsProfile) out = [...out, '--ads-profile', adsProfile];
  return out;
}

// Every command answers JSON, except the auth commands that only change the
// stored profile (login, logout, switch), which have no output to shape.
const PROFILE_COMMANDS = { login: true, logout: true, switch: true };
export function withOutput(args) {
  if (process.env.APPLE_ADS_NO_OUTPUT === '1') return args;
  const [tool, area, verb] = args;
  if (tool === 'ads' && area === 'auth' && Object.hasOwn(PROFILE_COMMANDS, verb)) return args;
  return args.includes('--output') ? args : [...args, '--output', 'json'];
}

export function withOptional(args, flag, envName) {
  const v = value(envName);
  return v ? [...args, flag, v] : args;
}

export function appendPaging(args) {
  let out = args;
  out = withOptional(out, '--limit', 'LIMIT');
  out = withOptional(out, '--offset', 'OFFSET');
  if (process.env.PAGINATE === '1') out = [...out, '--paginate'];
  return out;
}

/** The request file: APPLE_ADS_FILE, or APPLE_ADS_PAYLOAD_JSON written into the run's own recordings; null when neither is given. */
export function payloadFile() {
  const existing = value('APPLE_ADS_FILE');
  if (existing) return existing;
  const json = value('APPLE_ADS_PAYLOAD_JSON');
  if (!json) return null;
  const dir = runRecordingsDir(`apple_${action}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'request.json');
  writeFileSync(file, json);
  return file;
}

/** APPLE_ADS_CLI_ARGS split as a shell would: whitespace outside quotes, a backslash escaping the next character inside them. */
export function splitArgs(s) {
  if (!s) return [];
  const out = [];
  let cur = '';
  let quote = null;
  const chars = [...s][Symbol.iterator]();
  for (let next = chars.next(); !next.done; next = chars.next()) {
    const ch = next.value;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\') {
        const escaped = chars.next();
        if (escaped.done) throw new Error('APPLE_ADS_CLI_ARGS ends in an escape with nothing after it');
        cur += escaped.value;
      } else cur += ch;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (quote) throw new Error('APPLE_ADS_CLI_ARGS has an unterminated quote');
  if (cur) out.push(cur);
  return out;
}

export function ensureConfirmed(kind) {
  if (!confirmed)
    throw new Error(
      `${action} would ${kind}; set apple_ads_confirm=true, write_confirm=true, or submit=true in params to proceed`,
    );
}

/**
 * Raw `asc` arguments can do anything asc can, which no reading of their
 * words can bound, so a run of them is always a confirmed one.
 */
export function ensureCliArgsAllowed(args) {
  ensureConfirmed(`run raw asc arguments: ${args.join(' ')}`);
}
