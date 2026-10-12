// The environment the Overleaf pull runs with: the project and the linked repository that
// disambiguates it, the DOM dumps beside the run's recordings, the auth label and the
// persistent Overleaf browser profile shared by every Overleaf trajectory.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { statedText } from '../../_shared/inputs/stated.mjs';

export let PROJECT = process.argv[2];
if (!PROJECT) PROJECT = process.env.OVERLEAF_PROJECT;
export let REPO_SLUG = process.argv[3];
if (!REPO_SLUG) REPO_SLUG = process.env.OVERLEAF_GITHUB_REPO;
if (!PROJECT || !REPO_SLUG)
  throw new Error(
    'need <PROJECT> <REPO_SLUG>. PROJECT=24-hex id or title substring; REPO_SLUG=owner/name of the linked GitHub repo (the disambiguator).',
  );
export const IS_ID = /^[0-9a-fA-F]{24}$/.test(PROJECT);
export const REPO_LC = REPO_SLUG.toLowerCase();

export const SHOT_DIR = runRecordingsDir('overleaf_pull_github');
export const OVERLEAF_AUTH_LABEL = statedText(
  ['OVERLEAF_AUTH_LABEL'],
  'the session store label the Overleaf session is kept under',
);
// The persistent Overleaf browser profile sits with Weles's other browser
// profiles (WELES_BROWSER_PROFILE_ROOT, or ~/.local/state/weles/browser-profiles),
// one per auth label, never inside a checkout.
export const OVERLEAF_PROFILE_DIR = join(
  process.env.WELES_BROWSER_PROFILE_ROOT?.trim()
    ? process.env.WELES_BROWSER_PROFILE_ROOT.trim()
    : join(homedir(), '.local', 'state', 'weles', 'browser-profiles'),
  'overleaf',
  OVERLEAF_AUTH_LABEL.replace(/[^\w.-]+/g, '-'),
);
if (
  process.env.WELES_OVERLEAF_PERSISTENT_PROFILE !== '0' &&
  !process.env.WELES_USER_DATA_DIR
) {
  mkdirSync(OVERLEAF_PROFILE_DIR, { recursive: true });
  process.env.WELES_USER_DATA_DIR = OVERLEAF_PROFILE_DIR;
  console.log(
    `[pull_github] using persistent Overleaf browser profile: ${OVERLEAF_PROFILE_DIR}`,
  );
}
