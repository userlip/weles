// Probe Meta developer account verification without submitting phone/card data.
// Each page is recorded as it stands (title, text, visible controls); what it
// asks for is read from that record, not guessed from one language's words.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { redactedUrl } from '../../_shared/page/navigation/redacted.mjs';

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
          type: el.getAttribute('type') || '',
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
    ...data,
    controls: data.controls.map((control) => ({
      ...control,
      href: control.href && redactedUrl(control.href, page.url()),
    })),
  };
  console.log(JSON.stringify(record, null, INDENT));
  return data;
}

console.log(
  JSON.stringify(
    {
      stage: 'start',
      userDataDir: USER_DATA_DIR,
      headless: process.env.META_VERIFY_HEADLESS !== '0',
    },
    null,
    INDENT,
  ),
);

const s = await WSession.start({
  label: 'meta_developer_account_verification_probe',
  browser: process.env.BROWSER || 'chromium',
  proxy: process.env.PROXY_URL || 'direct',
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_VERIFY_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  await s.page.goto(
    'https://developers.facebook.com/async/developer/account/verification/',
    { waitUntil: 'domcontentloaded' },
  );
  await snapshot(s.page, 'verification_page');
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
