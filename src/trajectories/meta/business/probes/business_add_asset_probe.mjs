// Probe the non-submitting Add flow for Meta Business Settings assets. The Add
// control is found by the vision model from its description
// (`_shared/page/judged/seen.mjs`), in the account's language.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../../dist/browser/persona.js';
import { WSession } from '../../../../../dist/session/wsession.js';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { statedProxy, statedText } from '../../../_shared/inputs/stated.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { redactedUrl } from '../../../_shared/page/navigation/redacted.mjs';

const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
const BUSINESS_ID = statedText(
  ['META_BUSINESS_ID', 'BUSINESS_ID'],
  'the Meta Business Manager id this run acts in',
);
const ASSET_KIND = process.env.META_ASSET_KIND || 'apps';
mkdirSync(USER_DATA_DIR, { recursive: true });

const pagePaths = {
  apps: 'apps',
  ad_accounts: 'ad_accounts',
  system_users: 'system_users',
};

function stableProfilePersona() {
  const p = join(USER_DATA_DIR, 'persona.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const persona = generatePersona({ os: 'macos', browser: 'chromium' });
  writeFileSync(p, JSON.stringify(persona, null, 2));
  return persona;
}

async function snapshot(page, label) {
  await pageSettled(page);
  const data = await page.evaluate(() => {
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
    const controls = Array.from(
      document.querySelectorAll(
        'button, [role="button"], a, [role="menuitem"], input, textarea, [aria-label]',
      ),
    )
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = textOf(el) || el.getAttribute('placeholder') || '';
        return {
          text: text,
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          href: el.getAttribute('href') || '',
          placeholder: el.getAttribute('placeholder') || '',
          disabled:
            el.disabled === true || el.getAttribute('aria-disabled') === 'true',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      })
      .filter((item) => item.text || item.href || item.placeholder);
    return {
      title: document.title || null,
      bodyText: textOf(document.body),
      controls,
    };
  });
  console.log(
    JSON.stringify(
      {
        stage: 'snapshot',
        label,
        url: redactedUrl(page.url()),
        ...data,
        controls: data.controls.map((control) => ({
          ...control,
          href: control.href && redactedUrl(control.href, page.url()),
        })),
      },
      null,
      2,
    ),
  );
  return data;
}

async function clickEnabledAdd(page) {
  const target = await clickDescribed(
    page,
    `the enabled button that adds a new item to the ${ASSET_KIND.replace('_', ' ')} list of Business Settings`,
  );
  console.log(JSON.stringify({ stage: 'clicked_add', ...target }));
}

const path = pagePaths[ASSET_KIND];
if (!path) {
  console.log(`FAIL: unsupported META_ASSET_KIND=${ASSET_KIND}`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      stage: 'start',
      userDataDir: USER_DATA_DIR,
      businessId: BUSINESS_ID,
      assetKind: ASSET_KIND,
      headless: process.env.META_BUSINESS_HEADLESS !== '0',
    },
    null,
    2,
  ),
);

const s = await WSession.start({
  label: `meta_business_add_${ASSET_KIND}_probe`,
  browser: process.env.BROWSER || 'chromium',
  proxy: statedProxy('the Business add-asset probe'),
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  const url = `https://business.facebook.com/latest/settings/${path}?business_id=${encodeURIComponent(BUSINESS_ID)}`;
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  await snapshot(s.page, 'before_add');
  await clickEnabledAdd(s.page);
  await snapshot(s.page, 'after_add');
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
