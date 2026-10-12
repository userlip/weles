// Getting from wherever the keeper's tab happens to be to the Keyword Planner
// form for this customer: the product's own planner addresses (plus any planner
// address earlier runs recorded), the account picker Google puts in front of a
// multi-account login, and the one control that opens the keyword entry box.
// Google's routes say where the tab is; what a page offers, and the planner's
// controls, are judged and found by the vision model through the keeper
// (`shows`, `clickDescribed`) instead of English page phrases.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DIAG_DIR,
  RESULT_FILE,
  cid,
  dashedCustomerId,
  norm,
  preferredEmail,
} from './run_brief.mjs';
import {
  clickControl,
  clickDescribed,
  dismissChrome,
  evalState,
  fillKeywordInput,
  idle,
  nav,
  shows,
} from './keeper_browser.mjs';
import { handleGoogleLogin } from './google_login.mjs';

const ACCOUNT_PICKER = /selectaccount/i;
const SIGN_IN = /accounts\.google\.com/i;

function adsUrl(pathname) {
  const url = new URL(pathname, 'https://ads.google.com');
  url.searchParams.set('cid', cid);
  url.searchParams.set('authuser', process.env.GOOGLE_ADS_AUTHUSER || '1');
  return url.toString();
}

function savedPlannerUrls() {
  const files = [
    RESULT_FILE,
    join(DIAG_DIR, `keywords-${cid}.json`),
    ...readdirSync(DIAG_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(DIAG_DIR, name)),
  ];

  const urls = [];
  for (const file of [...new Set(files)]) {
    if (!existsSync(file)) continue;
    const record = JSON.parse(readFileSync(file, 'utf8'));
    for (const candidate of [
      record?.url,
      record?.report?.url,
      record?.browser?.report?.url,
    ]) {
      if (
        /^https:\/\/ads\.google\.com\/aw\/keywordplanner\//i.test(
          candidate || '',
        )
      )
        urls.push(candidate);
    }
  }
  return [...new Set(urls)];
}

function plannerCandidates(paths) {
  return [...paths.map((path) => adsUrl(path)), ...savedPlannerUrls()];
}

export async function selectGoogleAdsAccount() {
  const s = await evalState();
  if (
    !ACCOUNT_PICKER.test(String(s.url)) &&
    !(await shows('Does the page ask to choose a Google Ads account?'))
  )
    return true;
  const accountRow = [
    dashedCustomerId(cid).replace(/-/g, '[- ]?'),
    cid,
    preferredEmail().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ].join('|');
  if (
    !(await clickControl(accountRow, 'Google Ads account', {
      maxArea: 500_000,
    }))
  )
    return false;
  // Selection is done when Google Ads leaves the account-selection route.
  for (;;) {
    await idle('short');
    const after = await evalState();
    if (!ACCOUNT_PICKER.test(String(after.url))) return true;
  }
}

export async function ensureAdsReady(creds) {
  for (const url of plannerCandidates([
    '/aw/keywordplanner/ideas/new',
    '/aw/keywordplanner/ideas',
    '/aw/keywordplanner',
    '/aw/campaigns',
  ])) {
    await nav(url);
    const current = await evalState();
    if (SIGN_IN.test(String(current.url))) {
      if (!(await handleGoogleLogin(creds))) return false;
      await nav(url);
    }
    const after = await evalState();
    if (
      !/\/aw\/campaigns/i.test(url) &&
      (await shows(
        'Does the page say that Google Ads 2-step verification is required?',
      ))
    )
      continue;
    if (ACCOUNT_PICKER.test(String(after.url))) {
      if (await selectGoogleAdsAccount()) return true;
      continue;
    }
    // Google Ads keeps a signed-in account on its own /aw/ routes.
    if (/\/aw\//i.test(new URL(after.url).pathname)) {
      return await selectGoogleAdsAccount();
    }
  }
  return false;
}

export async function openKeywordPlanner() {
  for (const url of plannerCandidates([
    '/aw/keywordplanner/ideas/new',
    '/aw/keywordplanner/ideas',
    '/aw/keywordplanner',
    '/aw/keywordplanner/home',
  ])) {
    await nav(url);
    await selectGoogleAdsAccount();
    await dismissChrome();
    // The next candidate is tried when this one has sent the browser to a
    // sign-in or an account selection, or does not show the planner.
    const s = await evalState();
    if (SIGN_IN.test(String(s.url)) || ACCOUNT_PICKER.test(String(s.url)))
      continue;
    if (
      await shows(
        'Is the Google Ads Keyword Planner shown, offering to discover new keywords or to get search volume and forecasts?',
      )
    ) {
      return { ok: true, path: url, url: s.url, text: norm(s.text) };
    }
  }
  const s = await evalState();
  return { ok: false, url: s.url, text: norm(s.text) };
}

// The keyword box is the planner form's text area; the website field beside it
// is a single-line input.
async function keywordInputVisible() {
  const s = await evalState();
  return s.inputs.some((input) => input.visible && input.tag === 'textarea');
}

export async function chooseVolumeMode() {
  if (await keywordInputVisible()) return true;
  await dismissChrome();
  await clickDescribed(
    'the control that opens the box for entering a list of keywords to get their search volume and forecasts (a compact Add keywords button wins over the large card)',
  );
  return await keywordInputVisible();
}

export async function submitKeywords() {
  await fillKeywordInput();
  await dismissChrome();
  await clickDescribed(
    'the button that submits the entered keywords to get their results',
  );
  return true;
}
