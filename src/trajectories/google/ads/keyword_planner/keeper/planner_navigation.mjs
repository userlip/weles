// Getting from wherever the keeper's tab happens to be to the Keyword Planner
// form for this customer: the product's own planner addresses (plus any planner
// address earlier runs recorded), the account picker Google puts in front of a
// multi-account login, and the one control that opens the keyword entry box.
// Google's routes and hosts say where the tab is (the sign-in host through the
// shared Google session reader); what a page offers, and the planner's
// controls, are judged and found by the vision model through the keeper
// (`shows`, `clickDescribed`) instead of English page phrases.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { statedText } from '../../../../_shared/inputs/stated.mjs';
import { onGoogleSignIn } from '../../../../_shared/profile/google_session.mjs';
import {
  DIAG_DIR,
  RESULT_FILE,
  cid,
  norm,
  preferredEmail,
} from './run_brief.mjs';
import {
  clickDescribed,
  dismissChrome,
  evalState,
  fillKeywordInput,
  idle,
  nav,
  shows,
} from './keeper_browser.mjs';
import { handleGoogleLogin } from './google_login.mjs';

const GOOGLE_ADS_HOST = 'ads.google.com';

/** Whether `url` is Google Ads' account selection route. */
function onAccountPicker(url) {
  const { hostname, pathname } = new URL(url);
  return hostname === GOOGLE_ADS_HOST && pathname.startsWith('/nav/selectaccount');
}

/** Whether `url` is one of Google Ads' Keyword Planner routes. */
function onPlannerRoute(url) {
  const { hostname, pathname } = new URL(url);
  return hostname === GOOGLE_ADS_HOST && pathname.startsWith('/aw/keywordplanner');
}

function adsUrl(pathname) {
  const url = new URL(pathname, `https://${GOOGLE_ADS_HOST}`);
  url.searchParams.set('cid', cid);
  // Which signed-in Google account of the browser the planner opens under is
  // the caller's; the slot index is not guessed.
  url.searchParams.set(
    'authuser',
    statedText(
      ['GOOGLE_ADS_AUTHUSER'],
      "the browser's Google account index (authuser) the Ads customer is signed in as",
    ),
  );
  return url.toString();
}

/** Planner addresses earlier runs of this customer recorded in their reports. */
function savedPlannerUrls() {
  const files = [
    RESULT_FILE,
    join(DIAG_DIR, `keywords-${cid}.json`),
    ...readdirSync(DIAG_DIR)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(DIAG_DIR, name)),
  ];
  const urls = [];
  for (const file of new Set(files)) {
    if (!existsSync(file)) continue;
    const record = JSON.parse(readFileSync(file, 'utf8'));
    for (const candidate of [
      record?.url,
      record?.report?.url,
      record?.browser?.report?.url,
    ]) {
      if (typeof candidate === 'string' && onPlannerRoute(candidate))
        urls.push(candidate);
    }
  }
  return [...new Set(urls)];
}

function plannerCandidates(paths) {
  return [...paths.map((path) => adsUrl(path)), ...savedPlannerUrls()];
}

/**
 * Choose this customer on Google's account picker when the page shows one.
 * The account is found by the vision model; a picker still shown once the
 * choice settled is refused.
 */
export async function selectGoogleAdsAccount() {
  const s = await evalState();
  if (
    !onAccountPicker(s.url) &&
    !(await shows('Does the page ask to choose a Google Ads account?'))
  )
    return;
  await clickDescribed(
    `the Google Ads account ${cid} (customer id, possibly printed with dashes) of ${preferredEmail()} in the account list`,
  );
  await idle();
  const after = await evalState();
  if (onAccountPicker(after.url))
    throw new Error(
      `GOOGLE_ADS_ACCOUNT_NOT_SELECTED: Google Ads still asks for an account after ${cid} was chosen (url=${after.url})`,
    );
}

/**
 * Bring the keeper's tab to a signed-in Google Ads page of this customer,
 * signing in through the keeper when Google asks (a refused sign-in throws
 * with Google's step). Answers false when no planner address leads to a
 * signed-in Google Ads page.
 */
export async function ensureAdsReady(creds) {
  for (const url of plannerCandidates([
    '/aw/keywordplanner/ideas/new',
    '/aw/keywordplanner/ideas',
    '/aw/keywordplanner',
    '/aw/campaigns',
  ])) {
    await nav(url);
    const current = await evalState();
    if (onGoogleSignIn(current.url)) {
      await handleGoogleLogin(creds);
      await nav(url);
    }
    const after = await evalState();
    if (
      onPlannerRoute(url) &&
      (await shows(
        'Does the page say that Google Ads 2-step verification is required?',
      ))
    )
      continue;
    // Google Ads keeps a signed-in account on its own /aw/ routes; its account
    // picker asks which one first.
    const { pathname } = new URL(after.url);
    if (onAccountPicker(after.url) || pathname.startsWith('/aw/')) {
      await selectGoogleAdsAccount();
      return true;
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
    if (onGoogleSignIn(s.url) || onAccountPicker(s.url)) continue;
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
}
