// The environment the Apple Ads report harvest runs with.
import { runOutputPath } from '#run-output';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { statedText } from '../../../_shared/inputs/stated.mjs';
import { keptProfileDir } from '../../../_shared/profile/persona.mjs';

export const USER_DATA_DIR = keptProfileDir('apple_ads');
const runId = process.env.ACTION_LOG_ID;
if (runId && basename(runId) !== runId)
  throw new Error(`ACTION_LOG_ID must be a single path component: ${runId}`);

/** Where the harvest's diagnostics go: the stated directory, the managed run's recordings, else the hand run's output. */
function diagnosticsDir() {
  if (process.env.APPLE_ADS_DIAG_DIR) return process.env.APPLE_ADS_DIAG_DIR;
  if (runId)
    return join(
      statedText(
        ['WELES_RECORDINGS_ROOT'],
        'the recording root for a managed Apple Ads report harvest',
      ),
      runId,
    );
  return runOutputPath('apple-ads-report-harvest');
}
export const DIAG_DIR = diagnosticsDir();
// Which app, which presets and which date ranges are harvested are the
// caller's: an app id or campaign dates written here would read someone
// else's reports.
export const APP_ID = statedText(
  ['APPLE_ADS_APP_ID', 'APPLE_ADS_UI_APP_ID'],
  'the Apple Ads app whose reports are harvested',
);
export const SESSION_LABEL = 'apple_ads_report_harvest';
// The app's own report page, unless the run states another Apple Ads report address.
export const REPORT_URL = process.env.APPLE_ADS_REPORT_URL
  ? process.env.APPLE_ADS_REPORT_URL
  : `https://app-ads.apple.com/cm/app/${APP_ID}/report`;
export const CLOSE_AFTER_HARVEST =
  process.env.APPLE_ADS_CLOSE_AFTER_HARVEST === '1';
export const DATE_PRESETS = statedText(
  ['APPLE_ADS_DATE_PRESETS'],
  'the report date presets to snapshot, comma-separated as Apple Ads labels them',
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const EXACT_RANGE = /^([^=]+)=(\d\d\d\d-\d\d-\d\d)\.\.(\d\d\d\d-\d\d-\d\d)$/;
export const EXACT_RANGES = statedText(
  ['APPLE_ADS_EXACT_RANGES'],
  'the exact report ranges, comma-separated as label=YYYY-MM-DD..YYYY-MM-DD',
)
  .split(',')
  .map((value) => {
    // A malformed entry is refused, never dropped: a harvest missing a range
    // it was asked for would look complete.
    const match = value.trim().match(EXACT_RANGE);
    if (!match)
      throw new Error(
        `APPLE_ADS_EXACT_RANGES entry "${value.trim()}" is not label=YYYY-MM-DD..YYYY-MM-DD; nothing was harvested`,
      );
    const [, label, startTime, endTime] = match;
    return { label, startTime, endTime };
  });

process.env.WELES_CAPTURE_RESPONSE_BODIES ??= '1';
process.env.WELES_DISABLE_RECORDING ??= '1';
process.env.WELES_NO_INSTRUMENT ??= '1';

mkdirSync(DIAG_DIR, { recursive: true });
