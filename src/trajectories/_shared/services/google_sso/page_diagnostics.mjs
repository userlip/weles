// What the Google page in front of the driver actually says: its own text, the
// controls it offers, and — when the run asks for them — a screenshot beside the
// log line.
import { runOutputPath } from '#run-output';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function logGooglePageDiag(page, label) {
  let diag;
  try {
    diag = await page.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, ' ');
      const buttons = Array.from(
        document.querySelectorAll('button, [role="button"]'),
      )
        .map((el) => ({
          text: el.innerText.replace(/\s+/g, ' ').trim(),
          disabled: Boolean(
            el.disabled ||
              el.getAttribute('aria-disabled') === 'true' ||
              el.getAttribute('disabled') !== null,
          ),
        }))
        .filter((button) => button.text);
      // An attribute the element does not carry is reported as absent, because a
      // field with no declared type and a field declaring an empty type are two
      // different pages to read this diagnostic against.
      const inputs = Array.from(document.querySelectorAll('input')).map(
        (el) => ({
          type: el.getAttribute('type'),
          name: el.getAttribute('name'),
          autocomplete: el.getAttribute('autocomplete'),
          visible: Boolean(
            el.offsetWidth || el.offsetHeight || el.getClientRects().length,
          ),
          valueLength: el.value.length,
        }),
      );
      return {
        url: location.href,
        title: document.title,
        text,
        buttons,
        inputs,
      };
    });
  } catch (error) {
    // The log line then says why the page could not be read, at its address.
    diag = { url: page.url(), unreadable: error.message };
  }
  console.log(`[google_sso] ${label} diag=${JSON.stringify(diag)}`);

  if (
    process.env.GOOGLE_SSO_SCREENSHOTS === '1' &&
    process.env.GOOGLE_SSO_NO_SCREENSHOTS !== '1'
  ) {
    const dir =
      process.env.GOOGLE_SSO_DIAG_DIR || runOutputPath('google-sso-diag');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${label.replace(/[^\w-]/g, '_')}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`[google_sso] ${label} screenshot=${file}`);
  }
}

// The ways to verify Google lists: each entry carries its challenge type.
export async function collectGoogleAuthMethods(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-challengetype]')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      challengeType: el.getAttribute('data-challengetype'),
      text: el.innerText.replace(/\s+/g, ' ').trim(),
      aria: el.getAttribute('aria-label'),
    })),
  );
}
