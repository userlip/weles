// The Accounts Center page: the stable persona, sanitised URLs and snapshots,
// and the two questions the flow asks of the page - whether it asks for the
// SMS code, and whether it offers the phone-number form - answered by the
// vision model (`_shared/page/judged/seen.mjs`) in the account's language.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generatePersona } from '../../../../../dist/browser/persona.js';
import { USER_DATA_DIR } from './settings.mjs';
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { pageShows } from '../../../_shared/page/judged/seen.mjs';
import { redactedUrl } from '../../../_shared/page/navigation/redacted.mjs';

const INDENT = '  ';

export function stableProfilePersona() {
  const p = join(USER_DATA_DIR, 'persona.json');
  if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  const persona = generatePersona({ os: 'macos', browser: 'chromium' });
  writeFileSync(p, JSON.stringify(persona, null, 2));
  return persona;
}

export function sanitize(text) {
  return String(text || '')
    .replace(/\+\d[\d\s().-]{6,}\d/g, '<phone-redacted>')
    .replace(/\b\d{7,}\b/g, '<number-redacted>');
}

/** Whether the page asks for the confirmation code sent to the phone. */
export function asksForCode(page) {
  return pageShows(
    page,
    'Does the page ask for a confirmation code that was sent to a phone number?',
  );
}

/** Whether the page shows the form for entering a phone number. */
export function offersPhoneForm(page) {
  return pageShows(
    page,
    'Does the page show a form for entering a mobile phone number?',
  );
}

export async function bringBrowserToFront(s) {
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

export async function snapshot(page, label) {
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
    title: data.title,
    bodyText: sanitize(data.bodyText),
    controls: data.controls.map((control) => ({
      ...control,
      text: sanitize(control.text),
      href: control.href && redactedUrl(control.href, page.url()),
      placeholder: sanitize(control.placeholder),
    })),
  };
  console.log(JSON.stringify(record, null, INDENT));
  return data;
}
