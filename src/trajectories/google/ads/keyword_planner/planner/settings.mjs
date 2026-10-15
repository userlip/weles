// The environment the browser keyword planner runs with. The customer and
// keywords are read by the shared request readers (`../request.mjs`).
import { runOutputPath } from '#run-output';
import { mkdirSync } from 'node:fs';
import { keptProfileDir } from '../../../../_shared/profile/persona.mjs';
import { join } from 'node:path';
import { closeAllowedByEnv } from '../../_profile_guard.mjs';
import { readScopedLogin } from '../../../../../_shared/scoped-secrets.mjs';
import { customerIdOf, keywordsOf } from '../request.mjs';

export { squash as norm } from '../request.mjs';

export const GOOGLE_ADS_LOGIN = readScopedLogin('googleAds');
export const USER_DATA_DIR = keptProfileDir('google_ads');
export const DIAG_DIR =
  process.env.GOOGLE_ADS_DIAG_DIR ||
  runOutputPath('google-ads-keyword-planner');
export const RESULT_FILE =
  process.env.GOOGLE_ADS_RESULT_FILE || join(DIAG_DIR, 'keyword-planner.json');
export const CLOSE_AFTER_HARVEST = closeAllowedByEnv(
  'GOOGLE_ADS_CLOSE_AFTER_HARVEST',
);
export const cid = customerIdOf(
  process.env.GOOGLE_ADS_CUSTOMER_ID,
  'GOOGLE_ADS_CUSTOMER_ID',
);
export const keywords = keywordsOf(
  process.env.GOOGLE_ADS_KEYWORDS ||
    process.env.KEYWORDS ||
    process.env.KEYWORD,
  'GOOGLE_ADS_KEYWORDS (or KEYWORDS, KEYWORD)',
);

mkdirSync(DIAG_DIR, { recursive: true });

process.env.WELES_CAPTURE_RESPONSE_BODIES ??= '1';
process.env.WELES_DISABLE_RECORDING ??= '1';
process.env.WELES_NO_INSTRUMENT ??= '1';

process.env.GOOGLE_SSO_NO_SCREENSHOTS ??= '1';
