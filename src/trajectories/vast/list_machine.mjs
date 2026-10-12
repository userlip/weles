import { launchProfileChrome } from '../../browser/real_chrome.mjs';
import { findProfileByEmail } from '../../../dist/chrome/cookies.js';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { readScopedLogin } from '../../_shared/scoped-secrets.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';

const VAST_LOGIN = readScopedLogin('vastDashboard');
const EMAIL = VAST_LOGIN.email;
// The machine is rented out at this price, under this team; both are the
// owner's to set.
const PRICE_GPU = statedText(
  ['PRICE_GPU'],
  'the hourly price per GPU the machine is listed at, in US dollars',
);
const TEAM_NAME = statedText(
  ['VAST_TEAM_NAME'],
  'the Vast team whose context the machine is listed under',
);
const profile = findProfileByEmail(EMAIL);
if (!profile) {
  console.log('FAIL: no chrome profile');
  process.exit(1);
}
const CHROMIUM = process.env.CHROMIUM_PATH;
if (!CHROMIUM) {
  console.log('FAIL: CHROMIUM_PATH');
  process.exit(1);
}
const scratch = join(tmpdir(), `weles_list_${Date.now()}`);
mkdirSync(scratch, { recursive: true });
cpSync(profile.path, join(scratch, 'Default'), {
  recursive: true,
  dereference: false,
});
try {
  cpSync(
    join(homedir(), 'Library/Application Support/Google/Chrome/Local State'),
    join(scratch, 'Local State'),
  );
} catch {}

// The launch lives in the reviewed browser boundary. This flow runs on a copy
// of the operator's real Chrome profile, so the provider keeps treating it as
// the returning visitor it already trusts.
const ctx = await launchProfileChrome({
  userDataDir: scratch,
  executablePath: CHROMIUM,
  args: [],
  ignoreDefaultArgs: [],
  channel: null,
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const wait = () => pageSettled(page);

// The scratch directory is a copy of the operator's Chrome profile with its
// cookies and Local State. process.exit ends the run without running a
// finally block, so the copy is released explicitly before every exit, and a
// copy that could not be removed is named in the log.
async function release() {
  await ctx
    .close()
    .catch((e) => console.log(`[vast] browser close err: ${e.message}`));
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch (e) {
    console.log(
      `[vast] copied Chrome profile ${scratch} not removed: ${e.message}`,
    );
  }
}

try {
  await page.goto('https://cloud.vast.ai/', { waitUntil: 'domcontentloaded' });
  await wait();

  // Always attempt login — unreliable to detect from DOM, cheap to retry.
  {
    const popupP = ctx.waitForEvent('page').catch(() => null);
    // Sign-in button: Playwright locator.click routes through CDP with isTrusted=true.
    await page
      .locator('a, button, [role="button"]')
      .filter({ hasText: /^(sign\s*in|log\s*in|login)$/i })
      .first()
      .click()
      .catch(() => {});
    await wait();
    // "Continue with Google" — constrained to short buttons so we don't hit marketing copy.
    await page
      .locator('a, button, [role="button"], div')
      .filter({ hasText: /google/i })
      .filter({ hasText: /continue|with google/i })
      .first()
      .click()
      .catch(() => {});
    const popup = await popupP;
    if (popup) {
      try {
        await popup.waitForLoadState('domcontentloaded');
      } catch {}
      // Google's OAuth popup closes itself when sign-in completes; each step
      // it shows is answered until then.
      while (!popup.isClosed()) {
        const pu = popup.url();
        let path = '';
        try {
          path = new URL(pu).pathname;
        } catch {}
        if (path.includes('/signin/identifier')) {
          try {
            await popup.fill('input[type="email"]', EMAIL);
            await popup
              .click('#identifierNext, button:has-text("Next")')
              .catch(() => {});
          } catch {}
        } else if (
          path.includes('/challenge/pwd') ||
          path.includes('/challenge/password')
        ) {
          const pw = VAST_LOGIN.password;
          try {
            await popup.fill('input[type="password"]', pw);
            await popup
              .click('#passwordNext, button:has-text("Next")')
              .catch(() => {});
          } catch {}
        } else if (
          path.includes('/signin/oauth/') ||
          path.includes('/oauthconsent')
        ) {
          await popup
            .locator('button, [role="button"], a')
            .filter({ hasText: /^(continue|allow|confirm)$/i })
            .first()
            .click()
            .catch(() => {});
        }
        await wait();
      }
    }
  }

  const teamSwitched = await page.evaluate(async (teamName) => {
    const r = await fetch('/api/v0/auth/apikeys/', { credentials: 'include' });
    const keys = await r.json();
    const team = keys.apikeys.find(
      (k) => k.key_type === 'team' && k.team_name === teamName,
    );
    if (!team) return false;
    const saved = await fetch('/api/v0/users/save-context/', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ context_key_id: team.id }),
    });
    return saved.ok;
  }, TEAM_NAME);
  // A machine listed in the personal context would rent out under the wrong
  // owner.
  if (!teamSwitched)
    throw new Error(
      `the Vast context could not be switched to team ${TEAM_NAME}; nothing was listed`,
    );

  await page.goto('https://cloud.vast.ai/host/machines/', {
    waitUntil: 'domcontentloaded',
  });
  await wait();

  const uiTrace = [];
  page.on('request', (req) => {
    const u = req.url();
    if (
      u.includes('vast.ai/api') &&
      !u.includes('csp-reports') &&
      req.method() !== 'GET'
    ) {
      uiTrace.push(`${req.method()} ${u} ${req.postData() || ''}`);
    }
  });

  const settingsLoc = page
    .locator('button, [role="button"]')
    .filter({ hasText: /^SETTINGS$/ });
  const clicked = (await settingsLoc.count()) > 0;
  if (!clicked)
    throw new Error(
      'the Vast machines page shows no SETTINGS control; nothing was listed',
    );
  await settingsLoc.first().click();
  await wait();

  // The On-Demand price is the first empty text or number input the dialog
  // renders; it is read back before LIST, and a dialog without one refuses.
  const filled = await page.evaluate((p) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    ).set;
    const dialog = Array.from(
      document.querySelectorAll(
        '[role="dialog"], [class*="odal"], [class*="ialog"]',
      ),
    ).find((el) => el.offsetParent !== null);
    if (!dialog) return { filled: false, reason: 'no visible dialog' };
    const inputs = Array.from(
      dialog.querySelectorAll(
        'input[type="number"], input[type="text"], input:not([type])',
      ),
    ).filter((el) => el.offsetParent !== null);
    const first = inputs.find((el) => !el.value);
    if (!first)
      return {
        filled: false,
        reason: `no empty price input among ${inputs.length}`,
      };
    setter.call(first, p);
    first.dispatchEvent(new Event('input', { bubbles: true }));
    first.dispatchEvent(new Event('change', { bubbles: true }));
    first.blur();
    return { filled: true, held: first.value, label: first.placeholder };
  }, PRICE_GPU);
  console.log('fill_price ->', JSON.stringify(filled));
  if (!filled.filled || filled.held !== PRICE_GPU)
    throw new Error(
      `the listing price was not set to ${PRICE_GPU}: ${JSON.stringify(filled)}; nothing was listed`,
    );
  await wait();
  const listLoc = page
    .locator(
      '[role="dialog"] button, [class*="odal"] button, [class*="ialog"] button',
    )
    .filter({ hasText: /^LIST$/ })
    .first();
  if (!(await listLoc.count()) || (await listLoc.isDisabled()))
    throw new Error(
      `the LIST button is missing or disabled after the price ${PRICE_GPU} was set; nothing was listed`,
    );
  await listLoc.click();
  await wait();
  const toast = await page.evaluate(() => {
    const m = document.body.innerText.match(
      /[^\n]*(listed|success|error|fail|invalid)[^\n]*/i,
    );
    return m ? m[0] : null;
  });
  console.log('toast ->', toast);
  for (const t of uiTrace) console.log('net:', t);

  const shotPath = join(
    runRecordingsDir('vast_list_machine'),
    'list_result.png',
  );
  await page.screenshot({ path: shotPath, fullPage: true });
  console.log(`screenshot -> ${shotPath}`);
  console.log(
    `PASS: LIST clicked at $${PRICE_GPU}/GPU-hour under ${TEAM_NAME}`,
  );
  await release();
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  await release();
  process.exitCode = exitStatusFor(e);
}
