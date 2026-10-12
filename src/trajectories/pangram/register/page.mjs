import {
  humanClickLocator,
  humanIdlePause,
} from '../../../../dist/human/mouse.js';
import { humanFill, humanType } from '../../../../dist/human/keyboard.js';
import { clickOffered } from '../../_shared/page/judged/seen.mjs';

export async function dismissCookies(page) {
  if (await clickOffered(page, 'the button that accepts all cookies'))
    await humanIdlePause('short');
}

/** The visible inputs and controls of the signup page, for DIAG=1 runs. */
export async function dumpControls(page) {
  return page.evaluate(() => ({
    url: location.href,
    body: (document.body?.innerText || '').replace(/\s+/g, ' '),
    inputs: Array.from(document.querySelectorAll('input, textarea'))
      .filter((el) => el.getClientRects().length)
      .map((el) => ({
        tag: el.tagName,
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        placeholder: el.getAttribute('placeholder'),
        autocomplete: el.getAttribute('autocomplete'),
        valueLen: String(el.value || '').length,
      })),
    buttons: Array.from(document.querySelectorAll('button, [role="button"], a'))
      .filter((el) => el.getClientRects().length)
      .map((el) => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        text: (
          [el.textContent, el.getAttribute('aria-label')].find(Boolean) ?? ''
        )
          .replace(/\s+/g, ' ')
          .trim(),
        href: el.getAttribute('href'),
        disabled:
          Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true',
      }))
      .filter((x) => x.text || x.href),
  })); // allow-raw-playwright: read-only signup diagnostics
}

/** Type the value into the first visible locator of the list; false when none is visible. */
export async function fillFirst(page, locators, value) {
  for (const locator of locators) {
    const loc = locator.first();
    if ((await loc.count()) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    await humanClickLocator(page, loc);
    await humanIdlePause('short');
    await humanFill(page, loc, '');
    await humanType(page, value);
    return true;
  }
  return false;
}

/** Pangram's own session-status answer, read from inside the page. */
export async function sessionStatus(page) {
  return page
    .evaluate(async () => {
      const res = await fetch('https://web.pangram.com/api/session-status/', {
        credentials: 'include',
      });
      return { status: res.status, body: await res.text() };
    })
    .catch((e) => ({ status: false, body: String(e?.message || e) })); // allow-raw-playwright: authenticated same-origin status probe
}

export function isAuthenticatedStatus(status) {
  try {
    const parsed = JSON.parse(status.body);
    return parsed?.isAuthenticated === true;
  } catch {
    return /"isAuthenticated"\s*:\s*true/i.test(String(status.body || ''));
  }
}

/** Sign in with the email and password on a page that shows the login form. */
export async function loginWithPassword(page, email, password) {
  const emailOk = await fillFirst(
    page,
    [
      page.locator('input[type="email"]'),
      page.locator('input[name*="email" i]'),
      page.locator('input[placeholder*="email" i]'),
    ],
    email,
  );
  const passwordOk = await fillFirst(
    page,
    [
      page.locator('input[type="password"]').first(),
      page.locator('input[name*="password" i]').first(),
      page.locator('input[placeholder*="password" i]').first(),
    ],
    password,
  );
  if (!emailOk || !passwordOk) return false;
  // The login form submits from its password field.
  await page.keyboard.press('Enter');
  await humanIdlePause('deliberate');
  return true;
}
