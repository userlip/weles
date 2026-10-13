import { pageSettled } from '../../../_shared/page/settled.mjs';
// The Google Ads page as the campaign trajectory drives it: the stable
// persona, navigation, the sign-in route and the customer switch. Controls
// and fields are found by the vision model in the trajectory itself.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generatePersona } from '../../../../../dist/browser/persona.js';
import { CUSTOMER_ID, USER_DATA_DIR } from './settings.mjs';

export function stableProfilePersona() {
  const p = join(USER_DATA_DIR, 'persona.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const persona = generatePersona({ os: 'macos', browser: 'chromium' });
  writeFileSync(p, JSON.stringify(persona, null, 2));
  return persona;
}
export async function navigate(s, url) {
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
}

export async function bringBrowserToFront(s) {
  await s.page.bringToFront();
}

export function isLoginUrl(url) {
  return /accounts\.google\.com|ServiceLogin|signin/i.test(url);
}

export function normalizeCustomerId(id) {
  return id ? String(id).replace(/\D/g, '') : null;
}

export function currentCustomerId(url) {
  try {
    const u = new URL(url);
    return normalizeCustomerId(
      u.searchParams.get('ocid') ||
        u.searchParams.get('customerId') ||
        u.searchParams.get('authuser'),
    );
  } catch {
    return null;
  }
}

export async function ensureCustomer(s) {
  const target = normalizeCustomerId(CUSTOMER_ID);
  const before = currentCustomerId(s.page.url?.() ?? '');
  console.log(
    `[google-ads] current customer=${customerOf(before)} target=${target ? target : 'not named by GOOGLE_ADS_CUSTOMER_ID'}`,
  );
  if (!target) return before;
  if (before === target) return before;

  const switchUrl = `https://ads.google.com/aw/campaigns?ocid=${encodeURIComponent(target)}`;
  console.log(`[google-ads] switching customer -> ${target}`);
  await navigate(s, switchUrl);
  await pageSettled(s.page);
  const after = currentCustomerId(s.page.url?.() ?? '');
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
