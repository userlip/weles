// Meta Business Settings inspector for system-user/token paths. It reads each
// settings page of the run's portfolio as it stands - its title, text and
// visible controls, kept with the run (`_shared/diagnostics/page_state.mjs`) -
// and clicks nothing; what the page means is read from that record, not
// decided here from the words one language prints.
//
// META_BUSINESS_SETTINGS_PAGES (optional): comma-separated page names to read
// (the names below); all of them when unset. An unknown name is refused.

import { recordPageState } from '../../_shared/diagnostics/page_state.mjs';
import {
  BUSINESS_ID,
  businessSettingsUrl,
  startBusinessSession,
} from './business_session.mjs';

const RUN = 'meta_business_settings_status';
// The classic Business Settings root, beside the current Business Suite's
// settings pages below.
const CLASSIC_SETTINGS = new URL('https://business.facebook.com/settings/');
CLASSIC_SETTINGS.searchParams.set('business_id', BUSINESS_ID);
// The Business Settings pages read, by name and address.
const PAGES = Object.freeze({
  settings_root: CLASSIC_SETTINGS.toString(),
  latest_settings: businessSettingsUrl(''),
  business_users: businessSettingsUrl('business_users'),
  system_users_latest: businessSettingsUrl('system_users'),
  ad_accounts_latest: businessSettingsUrl('ad_accounts'),
  apps_latest: businessSettingsUrl('apps'),
  connected_apps_latest: businessSettingsUrl('connected_apps'),
  requests_latest: businessSettingsUrl('requests'),
  business_info: businessSettingsUrl('business_info'),
});
const requested = process.env.META_BUSINESS_SETTINGS_PAGES
  ? process.env.META_BUSINESS_SETTINGS_PAGES.split(',')
      .map((page) => page.trim())
      .filter(Boolean)
  : Object.keys(PAGES);
const unknown = requested.filter((page) => !Object.hasOwn(PAGES, page));
if (unknown.length)
  throw new Error(
    `META_BUSINESS_SETTINGS_PAGES names unknown pages ${unknown.join(', ')}; known: ${Object.keys(PAGES).join(', ')}`,
  );

const s = await startBusinessSession(RUN, 'the Business settings status read');
try {
  for (const page of requested) {
    await s.page.goto(PAGES[page], { waitUntil: 'domcontentloaded' });
    await recordPageState(s.page, RUN, page);
  }
} finally {
  await s.close();
}
