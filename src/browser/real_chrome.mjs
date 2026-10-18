// Launches raw Playwright on real Google Chrome (macOS install). Used for
// provider billing dashboards whose OAuth flow uses GSI storagerelay popup
// postMessage — weles's custom Chromium 147 strips the storagerelay-related
// features so the popup completes but the message never reaches the opener.
// Real Chrome supports the flow natively. No fingerprint risk here since we
// are connecting only to our own providers' billing dashboards.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pageSettled } from '../trajectories/_shared/page/settled.mjs';
import { runId, runRecordingsDir } from '../../dist/session/run-recordings.js';
import {
  customBrowserSearchHint,
  findCustomChromium,
} from '../../dist/session/find_browser.js';

// Use Weles Chromium (147), which Google's signin flow recognizes as a
// real Chrome browser (per src/trajectories/google/_export_cookies.mjs
// "Uses the custom Weles Chromium so Google doesn't reject with 'This
// browser or app may not be secure'"). Real /Applications/Google Chrome.app
// gets bot-detected even with stealth init scripts; Weles's anti-fingerprint
// patches make it look like a normal user. Combined with launchPersistentContext
// for cookie persistence, this lets the user log into Google ONCE
// (interactively if passkey/2FA, or with stored password) and have all 4
// OAuth-popup providers work non-interactively from there.
// The Weles Chromium is the exact release Stado installed for this
// deployment, found and verified by the same resolver every session uses;
// no build directory under one person's home is assumed.
const WELES_CHROMIUM = findCustomChromium();
if (!WELES_CHROMIUM)
  throw new Error(
    `Weles Chromium is not installed as a verified release: ${customBrowserSearchHint('chromium')}`,
  );

function profileDir() {
  const dir = join(homedir(), '.weles', 'chrome_profiles', 'service_balance');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function launchRealChrome({ label }) {
  if (!label)
    throw new Error(
      'launchRealChrome needs the label its recordings are kept under',
    );
  const dir = profileDir();
  const diagnosticsDir = runRecordingsDir('real_chrome', label);
  const context = await chromium.launchPersistentContext(dir, {
    executablePath: WELES_CHROMIUM,
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: null,
    recordVideo: { dir: diagnosticsDir },
  });
  const [opened] = context.pages();
  const page = opened ?? (await context.newPage());
  try {
    writeFileSync(
      join(diagnosticsDir, 'real_chrome_session.json'),
      JSON.stringify(
        {
          run_id: runId(),
          ...(process.env.ACTION ? { action: process.env.ACTION } : {}),
          label,
          profile_dir: dir,
          executable_path: WELES_CHROMIUM,
          launched_at: new Date().toISOString(),
        },
        null,
        '  ',
      ),
    );
  } catch (e) {
    console.log(
      `[real_chrome] session record ${join(diagnosticsDir, 'real_chrome_session.json')} not written: ${e.message}`,
    );
  }
  console.log(`[real_chrome] launched (label=${label}, profile=${dir})`);
  return {
    context,
    page,
    async close() {
      try {
        await context.close();
      } catch (e) {
        console.log(
          `[real_chrome] context close failed (profile=${dir}): ${e.message}`,
        );
      }
    },
  };
}

// Drive Google's identifier → password → consent on a real-Chrome page.
export async function googleSsoRealChrome(page, creds) {
  // The provider's redirect chain has finished once the page has settled.
  await pageSettled(page);
  if (!/accounts\.google\.com/.test(page.url())) {
    console.log(
      `[google_sso_chrome] FAIL: never reached google (url=${page.url()})`,
    );
    return false;
  }

  const emailIn = page
    .locator(
      'input[type="email"], input[name="identifier"], input#identifierId',
    )
    .filter({ visible: true })
    .first();
  await emailIn.waitFor({ state: 'visible' });
  await emailIn.click();
  await emailIn.pressSequentially(creds.email);
  console.log(`[google_sso_chrome] identifier filled (${creds.email})`);
  // Use #identifierNext only; bare [jsname="LgbsSe"] matches hidden audio-captcha button on bot-suspect sessions.
  await page
    .locator('#identifierNext button, #identifierNext')
    .filter({ visible: true })
    .first()
    .click();

  const password = page
    .locator('input[type="password"], input[name="Passwd"]')
    .filter({ visible: true })
    .first();
  const enterPw = page
    .locator('button:has-text("Enter your password")')
    .filter({ visible: true })
    .first();
  const tryAnother = page
    .locator('button:has-text("Try another way")')
    .filter({ visible: true })
    .first();
  let usedEnterPw = false;
  let usedTryAnother = false;
  for (;;) {
    // Whichever of the password field or an option this walk has not used yet
    // appears first decides the step. Google's "Verifying it's you" overlay
    // covers the options, so they count only once it is gone.
    const watched = [password.waitFor({ state: 'visible' })];
    const options = [];
    if (!usedEnterPw) options.push(enterPw.waitFor({ state: 'visible' }));
    if (!usedTryAnother) options.push(tryAnother.waitFor({ state: 'visible' }));
    if (options.length) {
      watched.push(
        page
          .getByText(/Verifying it.s you/i)
          .first()
          .waitFor({ state: 'hidden' })
          .then(() => Promise.any(options)),
      );
    } else if (!(await password.isVisible())) {
      console.log(
        `[google_sso_chrome] FAIL: google_password_challenge_unavailable — both password options used, no password field (url=${page.url()})`,
      );
      return false;
    }
    await Promise.any(watched);
    if (await password.isVisible()) break;
    console.log(`[google_sso_chrome] url=${page.url()}`);
    if (!usedEnterPw && (await enterPw.isVisible())) {
      usedEnterPw = true;
      console.log('[google_sso_chrome] clicking Enter your password');
      await enterPw.click({ force: true });
      await pageSettled(page);
      continue;
    }
    if (!usedTryAnother && (await tryAnother.isVisible())) {
      usedTryAnother = true;
      console.log('[google_sso_chrome] clicking Try another way');
      await tryAnother.click({ force: true });
      await pageSettled(page);
      continue;
    }
  }

  const pwIn = page
    .locator('input[type="password"], input[name="Passwd"]')
    .filter({ visible: true })
    .first();
  await pwIn.click();
  await pwIn.pressSequentially(creds.password);
  await page
    .locator('#passwordNext button, #passwordNext')
    .filter({ visible: true })
    .first()
    .click();
  return true;
}
