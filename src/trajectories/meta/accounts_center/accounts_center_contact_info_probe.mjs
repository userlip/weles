// Inspect Accounts Center contact info for Meta developer phone verification.
// Prints sanitized UI state and clicks only navigation/contact-info controls,
// each found by the vision model from its description
// (`_shared/page/judged/seen.mjs`) in the account's language.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { clickDescribed } from '../../_shared/page/judged/seen.mjs';
import { redactedUrl } from '../../_shared/page/navigation/redacted.mjs';
import { statedProxy } from '../../_shared/inputs/stated.mjs';

const INDENT = '  ';

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

function sanitize(text) {
  return String(text || '')
    .replace(/\+\d[\d\s().-]{6,}\d/g, '<phone-redacted>')
    .replace(/\b\d{7,}\b/g, '<number-redacted>');
}

async function bringBrowserToFront(s) {
  await s.page.bringToFront().catch(() => {});
  if (process.platform !== 'darwin') return;
  spawnSync('osascript', ['-e', 'tell application "Chromium" to activate'], {
    stdio: 'ignore',
  });
  spawnSync(
    'osascript',
    [
      '-e',
      'tell application "System Events" to set frontmost of every process whose name is "Chromium" to true',
    ],
    { stdio: 'ignore' },
  );
}

async function snapshot(page, label) {
  await pageSettled(page);
  const data = await page.evaluate(() => {
    const textOf = (el) => {
      if (!el) return '';
      return (
        el.innerText ||
        el.textContent ||
        el.getAttribute('aria-label') ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
    };
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
        'button, [role="button"], a, [role="menuitem"], input, textarea, select, [aria-label]',
      ),
    )
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: textOf(el) || el.getAttribute('placeholder') || '',
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
      bodyText: bodyText,
      controls,
    };
  });
  const record = {
    stage: 'snapshot',
    label,
    url: redactedUrl(page.url()),
    title: data.title,
    bodyText: sanitize(data.bodyText),
    controls: data.controls.map((control) => ({
      ...control,
      text: sanitize(control.text),
      href: control.href && redactedUrl(control.href, page.url()),
    })),
  };
  console.log(JSON.stringify(record, null, INDENT));
  return data;
}

async function clickControl(page, label, description) {
  const target = await clickDescribed(page, description);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

const start = {
  stage: 'start',
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
};
console.log(JSON.stringify(start, null, INDENT));

const s = await WSession.start({
  label: 'meta_accounts_center_contact_info_probe',
  browser: process.env.BROWSER || 'chromium',
  proxy: statedProxy('the Accounts Center contact-info probe'),
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS === '1',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  await bringBrowserToFront(s);
  await s.page.goto('https://accountscenter.facebook.com/', {
    waitUntil: 'domcontentloaded',
  });
  await snapshot(s.page, 'accounts_center_initial');
  await clickControl(
    s.page,
    'contact_info',
    'the Accounts Center entry that opens the contact information settings',
  );
  await snapshot(s.page, 'contact_info');
  await clickControl(
    s.page,
    'existing_phone',
    'the listed phone number in the contact information settings',
  );
  await snapshot(s.page, 'existing_phone');
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
