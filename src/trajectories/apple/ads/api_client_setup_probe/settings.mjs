// The environment the Apple Ads API setup probe runs with.
import { runOutputPath } from '#run-output';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { keptProfileDir } from '../../../_shared/profile/persona.mjs';

export const USER_DATA_DIR = keptProfileDir('apple_ads');
export const PUBLIC_KEY_PATH =
  process.env.ASC_ADS_PUBLIC_KEY_PATH ||
  join(homedir(), '.apple-ads', 'public-key.pem');
export const PRIVATE_KEY_PATH =
  process.env.ASC_ADS_PRIVATE_KEY_PATH ||
  join(homedir(), '.apple-ads', 'private-key.pem');
export const DIAG_DIR =
  process.env.APPLE_ADS_DIAG_DIR || runOutputPath('apple-ads-api-setup');
export const CLOSE_AFTER_PROBE =
  process.env.APPLE_ADS_CLOSE_AFTER_PROBE === '1';
mkdirSync(DIAG_DIR, { recursive: true });
