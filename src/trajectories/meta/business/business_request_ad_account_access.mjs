// Request non-transfer access to an existing Meta ad account from Business
// Settings. Each control - Add, the access-request option, Next, the role and
// the confirmation - is found by the vision model from its description, and
// each state the flow branches on - a refusal, a role still to choose, the
// dialog still open - is judged by it (`_shared/page/judged/seen.mjs`), in the
// language the account's Business Settings speak.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { humanType } from '../../../../dist/human/keyboard.js';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { redactedUrl } from '../../_shared/page/navigation/redacted.mjs';

const INDENT = '  ';
const NEVER =
  'Never a control that cancels, closes, transfers or creates a new ad account.';

const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
const BUSINESS_ID = statedText(
  ['META_BUSINESS_ID', 'BUSINESS_ID'],
  'the Meta Business Manager id this run acts in',
);
const AD_ACCOUNT_ID = statedText(
  ['AD_ACCOUNT_ID', 'META_AD_ACCOUNT_ID'],
  'the Meta ad account id this run acts on',
).replace(/^act_/, '');
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
  const data = await page.evaluate((adAccountId) => {
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
    const fields = Array.from(document.querySelectorAll('input, textarea'))
      .filter(visible)
      .map((el) => ({
        value: el.value || '',
        placeholder: el.getAttribute('placeholder') || '',
      }));
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
          value: el.value || '',
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
      accountPresent:
        bodyText.includes(adAccountId) ||
        fields.some((field) => field.value.includes(adAccountId)),
    };
  }, AD_ACCOUNT_ID);
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
  const target = await clickDescribed(page, `${description}. ${NEVER}`);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
}

/** Throws with the page text when Meta shows an error or a refusal. */
async function refuseOnError(page, result, step) {
  const failed = await pageShows(
    page,
    'Does the page show an error, a refusal of access, or a message that the ad account ID is missing or invalid?',
  );
  if (failed)
    throw new Error(
      `Meta refused or failed the ad-account access request for ${AD_ACCOUNT_ID} ${step}: ${result.bodyText}`,
    );
}

// The id goes into the open dialog's text field, found on the page, so no
// screen position is assumed.
async function fillAdAccountId(page) {
  const field = page
    .locator(
      '[role="dialog"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])',
    )
    .filter({ visible: true })
    .first();
  await field.waitFor({ state: 'visible' });
  await humanClickLocator(page, field);
  await page.keyboard.press('ControlOrMeta+A');
  await humanType(page, AD_ACCOUNT_ID);
  await pageSettled(page);
  // A request sent with another id asks access to someone else's account.
  const held = await field.inputValue();
  if (held.trim() !== String(AD_ACCOUNT_ID))
    throw new Error(
      `ad account id field holds ${JSON.stringify(held)}, not ${AD_ACCOUNT_ID}`,
    );
  console.log(
    JSON.stringify({
      stage: 'filled_ad_account_id',
      adAccountId: AD_ACCOUNT_ID,
    }),
  );
}

const start = {
  stage: 'start',
  userDataDir: USER_DATA_DIR,
  businessId: BUSINESS_ID,
  adAccountId: AD_ACCOUNT_ID,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
};
console.log(JSON.stringify(start, null, INDENT));

const s = await WSession.start({
  label: 'meta_business_request_ad_account_access',
  browser: process.env.BROWSER || 'chromium',
  proxy: statedProxy('the ad-account access request'),
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
try {
  const url = `https://business.facebook.com/latest/settings/ad_accounts?business_id=${encodeURIComponent(BUSINESS_ID)}`;
  await s.page.goto(url, { waitUntil: 'domcontentloaded' });
  await snapshot(s.page, 'initial_ad_accounts');
  await clickControl(
    s.page,
    'add',
    'the enabled button that adds an ad account on the Ad accounts page of Business Settings',
  );
  await snapshot(s.page, 'add_menu');
  await clickControl(
    s.page,
    'request_access',
    'the option in the open Add menu that requests access to an existing ad account',
  );
  await snapshot(s.page, 'request_form');
  await fillAdAccountId(s.page);
  const filled = await snapshot(s.page, 'ad_account_id_filled');
  if (!filled.accountPresent)
    throw new Error(
      `Meta did not keep ad-account id ${AD_ACCOUNT_ID} in the request form`,
    );
  await clickControl(
    s.page,
    'next_or_submit',
    'the enabled button that moves the open access request dialog to its next step or sends it',
  );
  let result = await snapshot(s.page, 'after_submit');
  await refuseOnError(s.page, result, 'after the id was submitted');
  if (
    await pageShows(
      s.page,
      'Does the open dialog ask to choose the role or access level being requested?',
    )
  ) {
    await clickControl(
      s.page,
      'select_role',
      'the switch or option that requests full control to manage the ad account, unless it is already on',
    );
    await snapshot(s.page, 'role_selected');
    await clickControl(
      s.page,
      'confirm_request',
      'the enabled button that confirms and sends the access request',
    );
    result = await snapshot(s.page, 'after_confirm');
    await refuseOnError(s.page, result, 'after the role was confirmed');
  }
  if (
    await pageShows(
      s.page,
      'Is the dialog for requesting access to an ad account still open, without a message that the request was sent?',
    )
  )
    throw new Error(
      `Meta kept the ad-account request dialog open for ${AD_ACCOUNT_ID}: ${result.bodyText}`,
    );
  console.log('PASS: Meta ad-account access request flow submitted');
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
