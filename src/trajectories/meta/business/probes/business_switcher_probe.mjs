// Probe Meta Business Suite's portfolio switcher with a logged-in Weles profile.
// The switcher is found by the vision model from its description
// (`_shared/page/judged/seen.mjs`) instead of a guessed point and a score over
// the words of one language and one business name.

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
        'button, [role="button"], a, [role="menuitem"], [aria-label]',
      ),
    )
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: textOf(el),
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          href: el.getAttribute('href') || '',
          disabled:
            el.disabled === true || el.getAttribute('aria-disabled') === 'true',
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      })
      .filter((item) => item.text || item.href);
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((el) => ({
        text: textOf(el),
        href: el.getAttribute('href') || '',
      }))
      .filter(({ href }) => /business_id=|business\.facebook\.com/.test(href));
    const bodyText = textOf(document.body);
    return {
      title: document.title || null,
      bodyText: bodyText,
      controls,
      links,
      businessIds: Array.from(
        new Set(
          [
            ...bodyText.matchAll(/\b\d{12,18}\b/g),
            ...links.flatMap((link) =>
              [...link.href.matchAll(/business_id=(\d+)/g)].map(
                (match) => match[1],
              ),
            ),
          ].map((match) => (Array.isArray(match) ? match[0] : match)),
        ),
      ),
    };
  });
  console.log(
    JSON.stringify(
      {
        stage: 'snapshot',
        label,
        url: redactedUrl(page.url()),
        ...data,
        links: data.links.map((link) => ({
          ...link,
          href: redactedUrl(link.href, page.url()),
        })),
      },
      null,
      2,
    ),
  );
  return data;
}

async function clickBusinessSwitcher(page) {
  const target = await clickDescribed(
    page,
    'the business portfolio selector that switches between business portfolios, near the top left of Meta Business Suite',
  );
  console.log(JSON.stringify({ stage: 'clicked_switcher', ...target }));
}

console.log(
  JSON.stringify(
    {
      stage: 'start',
      userDataDir: USER_DATA_DIR,
      businessId: BUSINESS_ID,
      headless: process.env.META_BUSINESS_HEADLESS !== '0',
    },
    null,
    2,
  ),
);

const s = await WSession.start({
  label: 'meta_business_switcher_probe',
  browser: process.env.BROWSER || 'chromium',
  proxy: statedProxy('the Business switcher probe'),
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  const url = `https://business.facebook.com/latest/settings/business_users?business_id=${encodeURIComponent(BUSINESS_ID)}`;
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  await snapshot(s.page, 'before_switcher');
  await clickBusinessSwitcher(s.page);
  await snapshot(s.page, 'after_switcher');
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
