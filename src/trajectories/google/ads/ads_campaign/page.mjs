import { pageSettled } from '../../../_shared/page/settled.mjs';
// The Google Ads page as the campaign trajectory drives it: navigation, the
// sign-in route and the customer switch. Controls and fields are found by
// the vision model in the trajectory itself.
import { CUSTOMER_ID } from './settings.mjs';

// Google signs every product in on its accounts host; a page there is the
// sign-in route, wherever on the host it stands.
const GOOGLE_ACCOUNTS_HOST = 'accounts.google.com';

export async function navigate(s, url) {
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
}

export async function bringBrowserToFront(s) {
  await s.page.bringToFront();
}

export function isLoginUrl(url) {
  return new URL(url).hostname === GOOGLE_ACCOUNTS_HOST;
}

export function normalizeCustomerId(id) {
  return id ? String(id).replace(/\D/g, '') : null;
}

/** The customer a Google Ads page URL names, or null when it names none. */
export function currentCustomerId(url) {
  const u = new URL(url);
  return normalizeCustomerId(
    u.searchParams.get('ocid') ||
      u.searchParams.get('customerId') ||
      u.searchParams.get('authuser'),
  );
}

export async function ensureCustomer(s) {
  const target = normalizeCustomerId(CUSTOMER_ID);
  const before = currentCustomerId(s.page.url());
  console.log(
    `[google-ads] current customer=${customerOf(before)} target=${target ? target : 'not named by GOOGLE_ADS_CUSTOMER_ID'}`,
  );
  if (!target) return before;
  if (before === target) return before;

  const switchUrl = `https://ads.google.com/aw/campaigns?ocid=${encodeURIComponent(target)}`;
  console.log(`[google-ads] switching customer -> ${target}`);
  await navigate(s, switchUrl);
  await pageSettled(s.page);
  const after = currentCustomerId(s.page.url());
  console.log(`[google-ads] customer after switch=${customerOf(after)}`);
  if (after && after !== target)
    throw new Error(
      `wrong Google Ads customer selected; expected=${target} actual=${after} url=${s.page.url()}`,
    );
  return after;
}

/** A customer id read from the page URL, or why there is none. */
function customerOf(id) {
  return id ? id : 'not in the page URL';
}
