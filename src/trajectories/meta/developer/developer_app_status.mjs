// Meta developer app status inspector.
//
// Uses a Weles browser session with an existing Meta login profile and prints a
// sanitized snapshot of the Meta developer app dashboard/settings pages: the
// title, text and visible controls as they stand. The app's mode is read from
// that record, not guessed here from the words one language prints.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { redactedUrl } from '../../_shared/page/navigation/redacted.mjs';

const APP_ID = statedText(
  ['META_APP_ID', 'NEXT_PUBLIC_META_ADS_APP_ID'],
  'the Meta app id this run acts on',
);
const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
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

const urls = [
  ['dashboard', `https://developers.facebook.com/apps/${APP_ID}/dashboard/`],
  [
    'basic_settings',
    `https://developers.facebook.com/apps/${APP_ID}/settings/basic/`,
  ],
  [
    'app_review',
    `https://developers.facebook.com/apps/${APP_ID}/app-review/permissions/`,
  ],
  ['roles', `https://developers.facebook.com/apps/${APP_ID}/roles/roles/`],
];

console.log(
  JSON.stringify(
    {
      stage: 'start',
      appId: APP_ID,
      userDataDir: USER_DATA_DIR,
      headless: process.env.META_DEV_HEADLESS !== '0',
    },
    null,
    2,
  ),
);

const s = await WSession.start({
  label: 'meta_developer_app_status',
  browser: process.env.BROWSER || 'chromium',
  proxy: process.env.PROXY_URL || 'direct',
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_DEV_HEADLESS !== '0',
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
