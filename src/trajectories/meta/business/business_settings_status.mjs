// Meta Business Settings inspector for system-user/token paths. It reads each
// settings page as it stands - its title, text and visible controls - and
// clicks nothing; what the page means is read from that record, not decided
// here from the words one language prints.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { redactedUrl } from '../../_shared/page/navigation/redacted.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';

const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
const BUSINESS_ID =
  process.env.META_BUSINESS_ID || process.env.BUSINESS_ID || '';
const PAGE_FILTER = (process.env.META_BUSINESS_SETTINGS_PAGES || '')
  .split(',')
  .map((page) => page.trim())
  .filter(Boolean);
mkdirSync(USER_DATA_DIR, { recursive: true });

function stableProfilePersona() {
  const p = join(USER_DATA_DIR, 'persona.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const persona = generatePersona({ os: 'macos', browser: 'chromium' });
  writeFileSync(p, JSON.stringify(persona, null, 2));
  return persona;
}

async function snapshot(page, label) {
  await pageSettled(page);
  const data = await page
    .evaluate(() => {
      const textOf = (el) =>
        (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
          .replace(/\s+/g, ' ')
          .trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const bodyText = textOf(document.body);
      const controls = Array.from(
        document.querySelectorAll(
          'button, [role="button"], a, input[type="button"], input[type="submit"]',
        ),
      )
        .filter(visible)
        .map((el) => ({
          text: textOf(el),
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          href: el.getAttribute('href') || '',
          disabled:
            el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        }))
        .filter((item) => item.text || item.href);
      return {
        title: document.title || null,
        bodyText,
        controls,
      };
    })
    .catch((error) => ({ error: error.message || String(error) }));
  console.log(
    JSON.stringify(
      {
        stage: 'snapshot',
        label,
        url: redactedUrl(page.url()),
        ...data,
      },
      null,
      2,
    ),
  );
}

const businessQuery = BUSINESS_ID
  ? `?business_id=${encodeURIComponent(BUSINESS_ID)}`
  : '';
const urls = [
  ['settings_root', `https://business.facebook.com/settings/${businessQuery}`],
  [
    'latest_settings',
    `https://business.facebook.com/latest/settings/${businessQuery}`,
  ],
  [
    'business_users',
    `https://business.facebook.com/latest/settings/business_users${businessQuery}`,
  ],
  [
    'system_users_latest',
    `https://business.facebook.com/latest/settings/system_users${businessQuery}`,
  ],
  [
    'ad_accounts_latest',
    `https://business.facebook.com/latest/settings/ad_accounts${businessQuery}`,
  ],
  [
    'apps_latest',
    `https://business.facebook.com/latest/settings/apps${businessQuery}`,
  ],
  [
    'connected_apps_latest',
    `https://business.facebook.com/latest/settings/connected_apps${businessQuery}`,
  ],
  [
    'requests_latest',
    `https://business.facebook.com/latest/settings/requests${businessQuery}`,
  ],
  [
    'business_info',
    `https://business.facebook.com/latest/settings/business_info${businessQuery}`,
  ],
].filter(([label]) => !PAGE_FILTER.length || PAGE_FILTER.includes(label));

console.log(
  JSON.stringify(
    {
      stage: 'start',
      userDataDir: USER_DATA_DIR,
      businessId: BUSINESS_ID || null,
      pageFilter: PAGE_FILTER,
      headless: process.env.META_BUSINESS_HEADLESS !== '0',
    },
    null,
    2,
  ),
);

const s = await WSession.start({
  label: 'meta_business_settings_status',
  browser: process.env.BROWSER || 'chromium',
  proxy: statedProxy('the Business settings status read'),
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  for (const [label, url] of urls) {
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await snapshot(s.page, label);
  }
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
