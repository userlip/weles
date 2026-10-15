// The Meta Business Suite session every Business trajectory runs in: the
// persistent Meta profile (WELES_USER_DATA_DIR or ADS_PROFILE_DIR), its
// shared profile persona, the stated proxy and the Business portfolio the
// run acts in, and the address of a Business Settings page in that
// portfolio.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WSession } from '../../../../dist/session/wsession.js';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import { stableProfilePersona } from '../../_shared/profile/persona.mjs';

export const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
mkdirSync(USER_DATA_DIR, { recursive: true });

export const BUSINESS_ID = statedText(
  ['META_BUSINESS_ID', 'BUSINESS_ID'],
  'the Meta Business Manager id this run acts in',
);

export const HEADLESS = process.env.META_BUSINESS_HEADLESS !== '0';

/** The Business Settings page at `path` of the run's portfolio. */
export function businessSettingsUrl(path) {
  const url = new URL(`https://business.facebook.com/latest/settings/${path}`);
  url.searchParams.set('business_id', BUSINESS_ID);
  return url.toString();
}

/** The business portfolios a page state's links name by their business_id. */
export function linkedBusinessIds(state) {
  return [
    ...new Set(
      state.controls
        .filter((control) => control.href)
        .map((control) =>
          new URL(control.href, state.url).searchParams.get('business_id'),
        )
        .filter(Boolean),
    ),
  ];
}

/** A session in the Meta profile, for `purpose` (named in a missing-proxy refusal). */
export async function startBusinessSession(label, purpose) {
  console.log(
    JSON.stringify({
      stage: 'start',
      run: label,
      userDataDir: USER_DATA_DIR,
      businessId: BUSINESS_ID,
      headless: HEADLESS,
    }),
  );
  return WSession.start({
    label,
    proxy: statedProxy(purpose),
    persona: stableProfilePersona(USER_DATA_DIR),
    userDataDir: USER_DATA_DIR,
    headless: HEADLESS,
    pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
  });
}
