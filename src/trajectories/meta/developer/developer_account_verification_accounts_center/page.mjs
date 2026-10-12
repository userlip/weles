// The Accounts Center page (persona, sanitised URLs, snapshots), the phone
// number shapes, and what the verification page asks for - the terms alone,
// a phone number, Accounts Center, the SMS code - judged by the vision model
// (`_shared/page/judged/seen.mjs`) instead of English phrases.
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

/** What the developer verification page asks for, as the model reads it. */
export async function verificationState(page) {
  return {
    termsOnly: await pageShows(
      page,
      "Does the page only ask to accept Meta's Platform Terms and Developer Policies, without a field for a phone number?",
    ),
    phoneStep: await pageShows(
      page,
      'Does the page ask for a mobile number to send a verification SMS to?',
    ),
    accountsCenterRequired: await pageShows(
      page,
      'Does the page say this action can only be completed in Accounts Center?',
    ),
    smsCode: await pageShows(
      page,
      'Does the page ask for a verification code that was sent by SMS?',
    ),
  };
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
    ...data,
    controls: data.controls.map((control) => ({
      ...control,
      href: control.href && redactedUrl(control.href, page.url()),
    })),
  };
  console.log(JSON.stringify(record, null, INDENT));
  return data;
}

export function normalizePhone(raw) {
  const phone = String(raw || '').trim();
  const digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  return {
    phone,
    country: digits.startsWith('48')
      ? '+48'
      : digits.startsWith('1')
        ? '+1'
        : 'unknown',
    digitCount: digits.length,
  };
}

export function phoneCountry(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('48')) return '+48';
  if (digits.startsWith('1')) return '+1';
  return 'unknown';
}

export function phoneNationalNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('48')) return digits.slice('48'.length);
  if (digits.startsWith('1')) return digits.slice(1);
  return digits;
}
