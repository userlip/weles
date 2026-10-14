// Search Meta owner/approval surfaces and complete any exposed safe approval
// steps. Whether a surface offers an approval, an activation, a request tab
// or a confirmation is judged by the vision model, and the control it names is
// clicked (`_shared/page/judged/seen.mjs`); nothing here reads one language's
// button words, and the model is told never to pick a cancel, delete, leave or
// transfer control.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { generatePersona } from '../../../../dist/browser/persona.js';
import { WSession } from '../../../../dist/session/wsession.js';
import { pageSettled } from '../../_shared/page/settled.mjs';
import { statedProxy, statedText } from '../../_shared/inputs/stated.mjs';
import { clickDescribed, pageShows } from '../../_shared/page/judged/seen.mjs';
import { redactedUrl } from '../../_shared/page/navigation/redacted.mjs';

const INDENT = '  ';
const NEVER =
  'Never a control that cancels, deletes, removes, leaves or transfers anything.';

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
const APP_ID = statedText(['META_APP_ID'], 'the Meta app id this run acts on');
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
  const data = await page.evaluate(
    ({ adAccountId, appId }) => {
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
      const bodyText = textOf(document.body);
      const controls = Array.from(
        document.querySelectorAll(
          'button, [role="button"], a, [role="menuitem"], input[type="button"], input[type="submit"]',
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
              el.disabled === true ||
              el.getAttribute('aria-disabled') === 'true',
            x: Math.round(rect.left + rect.width / 2),
            y: Math.round(rect.top + rect.height / 2),
          };
        })
        .filter((item) => item.text || item.href);
      return {
        title: document.title || null,
        bodyText: bodyText,
        controls,
        adAccountPresent: bodyText.includes(adAccountId),
        appPresent: bodyText.includes(appId),
      };
    },
    { adAccountId: AD_ACCOUNT_ID, appId: APP_ID },
  );
  const record = {
    stage: 'snapshot',
    label,
    url: redactedUrl(page.url()),
    ...data,
  };
  console.log(JSON.stringify(record, null, INDENT));
  return data;
}

/** Clicks what `description` names when the page shows what `question` asks. */
async function clickWhenShown(page, label, question, description) {
  if (!(await pageShows(page, `${question} ${NEVER}`))) return false;
  const target = await clickDescribed(page, `${description}. ${NEVER}`);
  console.log(JSON.stringify({ stage: 'clicked', label, ...target }));
  return true;
}

async function confirmWhenAsked(page, label) {
  await clickWhenShown(
    page,
    `${label}_confirm`,
    'Is a dialog open asking to confirm the action just taken?',
    'the button in the open dialog that confirms the action',
  );
}

async function tryApproveOrActivate(page, label) {
  if (
    await clickWhenShown(
      page,
      `${label}:approve`,
      'Is there an enabled control that approves or accepts a pending access request?',
      'the enabled control that approves or accepts the pending access request',
    )
  ) {
    await confirmWhenAsked(page, `${label}:approve`);
    return 'approval_clicked';
  }
  if (
    await clickWhenShown(
      page,
      `${label}:activate`,
      'Is there an enabled control that activates or reactivates the app or switches it to live?',
      'the enabled control that activates the app or switches it to live',
    )
  ) {
    await confirmWhenAsked(page, `${label}:activate`);
    return 'activate_clicked';
  }
  return null;
}

/** The request lists Business Settings shows as tabs, by what each holds. */
const REQUEST_TABS = [
  { tab: 'needs_review', holds: 'requests that need your review' },
  { tab: 'sent', holds: 'requests you sent' },
  { tab: 'completed', holds: 'completed requests' },
];

const candidateUrls = [
  [
    'business_requests',
    `https://business.facebook.com/latest/settings/requests?business_id=${encodeURIComponent(BUSINESS_ID)}`,
  ],
  [
    'business_requests_unscoped',
    'https://business.facebook.com/latest/settings/requests',
  ],
  [
    'legacy_business_requests',
    `https://business.facebook.com/settings/requests?business_id=${encodeURIComponent(BUSINESS_ID)}`,
  ],
  [
    'business_ad_account_pending',
    `https://business.facebook.com/latest/settings/ad_accounts/?business_id=${encodeURIComponent(BUSINESS_ID)}&selected_asset_type=ad-account`,
  ],
  [
    'ads_account_settings_act',
    `https://business.facebook.com/ads/manager/account_settings/?act=${encodeURIComponent(AD_ACCOUNT_ID)}`,
  ],
  [
    'ads_manager_act',
    `https://business.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(AD_ACCOUNT_ID)}`,
  ],
  [
    'developer_app',
    `https://developers.facebook.com/apps/${encodeURIComponent(APP_ID)}/dashboard/`,
  ],
  ['developer_apps', 'https://developers.facebook.com/apps/'],
];

const start = {
  stage: 'start',
  userDataDir: USER_DATA_DIR,
  businessId: BUSINESS_ID,
  adAccountId: AD_ACCOUNT_ID,
  appId: APP_ID,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
};
console.log(JSON.stringify(start, null, INDENT));

const s = await WSession.start({
  label: 'meta_business_approval_autopilot',
  browser: process.env.BROWSER || 'chromium',
  proxy: statedProxy('the Business approval autopilot'),
  persona: stableProfilePersona(),
  userDataDir: USER_DATA_DIR,
  headless: process.env.META_BUSINESS_HEADLESS !== '0',
  pageDiagnostics: process.env.WELES_PAGE_DIAGNOSTICS === '1',
});

let exitCode = 0;
const actions = [];
try {
  for (const [label, url] of candidateUrls) {
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await snapshot(s.page, label);
    const action = await tryApproveOrActivate(s.page, label);
    if (action) {
      actions.push({ label, action });
      await snapshot(s.page, `${label}:after_action`);
    }
    if (/requests/i.test(label)) {
      for (const { tab, holds } of REQUEST_TABS) {
        const opened = await clickWhenShown(
          s.page,
          `${label}:${tab}`,
          `Is there a tab listing ${holds}?`,
          `the tab listing ${holds}`,
        );
        if (!opened) continue;
        const tabSnap = await snapshot(s.page, `${label}:${tab}`);
        const tabAction = await tryApproveOrActivate(s.page, `${label}:${tab}`);
        if (tabAction) {
          actions.push({ label: `${label}:${tab}`, action: tabAction });
          await snapshot(s.page, `${label}:${tab}:after_action`);
        }
        if (tabSnap.adAccountPresent) {
          const target = await clickDescribed(
            s.page,
            `the request row for ad account ${AD_ACCOUNT_ID}. ${NEVER}`,
          );
          console.log(
            JSON.stringify({
              stage: 'clicked',
              label: `${label}:${tab}:open_request`,
              ...target,
            }),
          );
          await snapshot(s.page, `${label}:${tab}:request_opened`);
        }
      }
    }
  }
  console.log(JSON.stringify({ stage: 'actions', actions }, null, INDENT));
  if (!actions.length) {
    console.log(
      'PASS: approval autopilot found no exposed approval or activation controls in the current Weles Meta session',
    );
  } else {
    console.log('PASS: approval autopilot executed exposed Meta controls');
  }
} catch (error) {
  exitCode = 1;
  console.log(`FAIL: ${error.message || String(error)}`);
} finally {
  await s
    .close()
    .catch((e) => console.log(`[session] close failed: ${e.message}`));
}

if (exitCode) process.exit(exitCode);
