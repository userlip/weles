// Connect the configured Meta app ID to the current Business portfolio via UI.
// Each control is found by the vision model from its description
// (`_shared/page/judged/seen.mjs`), and the connection counts only once the
// app ID is listed on the portfolio's Apps page.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { redactedUrl } from '../../_shared/page/navigation/redacted.mjs';

const INDENT = '  ';

const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
const BUSINESS_ID = statedText(
  ['META_BUSINESS_ID', 'BUSINESS_ID'],
  'the Meta Business Manager id this run acts in',
);
const APP_ID = statedText(
  ['META_APP_ID', 'NEXT_PUBLIC_META_ADS_APP_ID'],
  'the Meta app id this run acts on',
);
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
  const data = await page.evaluate((appId) => {
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
          placeholder: el.getAttribute('placeholder') || '',
          disabled:
            el.disabled === true || el.getAttribute('aria-disabled') === 'true',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      })
      .filter((item) => item.text || item.placeholder);
    const bodyText = textOf(document.body);
    return {
      title: document.title || null,
      bodyText: bodyText,
      controls,
      appPresent: bodyText.includes(appId),
    };
  }, APP_ID);
  const record = {
    stage: 'snapshot',
    label,
    url: redactedUrl(page.url()),
    ...data,
  };
  console.log(JSON.stringify(record, null, INDENT));
  return data;
}

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

// The id goes into the open dialog's text field, found on the page, so no
// screen position is assumed.
async function fillAppId(page) {
  const field = page
    .locator(
      '[role="dialog"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    )
    .filter({ visible: true })
    .first();
  await field.waitFor({ state: 'visible' });
  await humanClickLocator(page, field);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, APP_ID);
  await pageSettled(page);
  const held = await field.inputValue();
  if (held.trim() !== String(APP_ID))
    throw new Error(
      `app id field holds ${JSON.stringify(held)}, not ${APP_ID}`,
    );
  console.log(JSON.stringify({ stage: 'filled_app_id', appId: APP_ID }));
  return true;
}

const start = {
  stage: 'start',
  userDataDir: USER_DATA_DIR,
  businessId: BUSINESS_ID,
  appId: APP_ID,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
};
console.log(JSON.stringify(start, null, INDENT));

const s = await WSession.start({
  label: 'meta_business_connect_app',
  browser: process.env.BROWSER || 'chromium',
  proxy: process.env.PROXY_URL || 'direct',
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  const url = `https://business.facebook.com/latest/settings/apps?business_id=${encodeURIComponent(BUSINESS_ID)}`;
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  await snapshot(s.page, 'initial_apps');
  await clickControl(
    s.page,
    'add',
    'the enabled button that adds an app on the Apps page of Business Settings',
  );
  await snapshot(s.page, 'add_menu');
  await clickControl(
    s.page,
    'connect_app_id',
    'the option in the open Add menu that connects an existing app by its app ID',
  );
  await snapshot(s.page, 'connect_app_form');
  await fillAppId(s.page);
  await snapshot(s.page, 'app_id_filled');
  await clickControl(
    s.page,
    'submit_app_id',
    'the enabled button that submits the app ID in the open dialog (not the one that closes or cancels it)',
  );
  const result = await snapshot(s.page, 'after_submit');
  if (
    await pageShows(
      s.page,
      'Does the page show an error or a refusal of the app connection?',
    )
  ) {
    throw new Error(
      `Meta refused or failed the connection of app ${APP_ID}: ${result.bodyText}`,
    );
  }
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  const listed = await snapshot(s.page, 'apps_after_submit');
  if (!listed.appPresent)
    throw new Error(
      `the connection was submitted but app ${APP_ID} is not listed on the portfolio's Apps page`,
    );
  console.log(
    `PASS: Meta app ${APP_ID} is connected to business ${BUSINESS_ID}`,
  );
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
