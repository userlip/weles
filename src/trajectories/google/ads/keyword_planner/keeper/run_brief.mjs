// What this run was asked for and how it answers. The Google Ads customer, the
// keywords to look up (read by the shared request readers, `../request.mjs`),
// the keeper session whose browser holds the login, the Skarbiec identity the
// run signs in with, and the single JSON record it writes. A refusal writes
// its record with the `blocked` cause and is then thrown, so the run fails
// with it.

import { runOutputPath } from '#run-output';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readScopedLogin } from '../../../../../_shared/scoped-secrets.mjs';
import { statedText } from '../../../../_shared/inputs/stated.mjs';
import { customerIdOf, keywordsOf } from '../request.mjs';

export { squash as norm } from '../request.mjs';

const INDENT = '  ';
const GOOGLE_ADS_LOGIN = readScopedLogin('googleAds');
// The keeper session holding the signed-in browser and the customer whose
// planner is read are the caller's; neither is assumed.
export const SESSION = statedText(
  ['SESSION', 'GOOGLE_ADS_KEEPER_SESSION'],
  'the keeper session (weles keeper) whose browser holds the Google Ads login',
);
export const SOCK = join(homedir(), '.weles', 'keeper', SESSION, 'socket');
export const cid = customerIdOf(
  statedText(
    ['GOOGLE_ADS_CUSTOMER_ID'],
    'the Google Ads customer id whose Keyword Planner is read',
  ),
  'GOOGLE_ADS_CUSTOMER_ID',
);
export const DIAG_DIR =
  process.env.GOOGLE_ADS_DIAG_DIR ||
  runOutputPath('google-ads-keyword-planner');
export const RESULT_FILE =
  process.env.GOOGLE_ADS_RESULT_FILE || join(DIAG_DIR, `keywords-${cid}.json`);
export const keywords = keywordsOf(
  process.env.GOOGLE_ADS_KEYWORDS ||
    process.env.KEYWORDS ||
    process.env.KEYWORD,
  'GOOGLE_ADS_KEYWORDS (or KEYWORDS, KEYWORD)',
);

mkdirSync(DIAG_DIR, { recursive: true });
mkdirSync(dirname(RESULT_FILE), { recursive: true });

export function preferredEmail() {
  return GOOGLE_ADS_LOGIN.email;
}

export function ssoCreds() {
  return { ...GOOGLE_ADS_LOGIN, source: 'skarbiec' };
}

/**
 * The record's JSON text with the login's own secrets blanked: the password
 * as JSON writes it, and the TOTP secret also as Google prints it, in groups
 * separated by spaces.
 */
function redact(json) {
  const password = JSON.stringify(GOOGLE_ADS_LOGIN.password).replace(
    /^"|"$/g,
    '',
  );
  let safe = json.replaceAll(password, '<redacted>');
  if (GOOGLE_ADS_LOGIN.totpSecret)
    safe = safe.replace(
      new RegExp(GOOGLE_ADS_LOGIN.totpSecret.split('').join('\\s?'), 'gi'),
      '<redacted>',
    );
  return safe;
}

/** Write the run's record, with the login's secrets blanked. */
export function writeResult(report) {
  const safe = redact(JSON.stringify(report, null, INDENT));
  writeFileSync(RESULT_FILE, safe);
  console.log(safe);
}

/** Write a refusal record, then throw it so the run fails with its cause. */
export function refuse(report) {
  writeResult({ ok: false, session: SESSION, ...report });
  const refusal = new Error(
    `${report.blocked}: Keyword Planner keeper run refused`,
  );
  refusal.reported = true;
  throw refusal;
}

export function socketReady() {
  return existsSync(SOCK);
}
