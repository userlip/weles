import { pageSettled } from '../../../../_shared/page/settled.mjs';
// Driving the Keyword Planner page: the account selector, the keyword input,
// and the harvest. Google's routes, the account's own id and the form's text
// area are read from the page; whether the planner is shown, and its menu,
// mode and results controls, are judged and found by the vision model
// (`_shared/page/judged/seen.mjs`) in the account's interface language.
import { humanClickLocator } from '../../../../../../dist/human/mouse.js';
import { humanFill } from '../../../../../../dist/human/keyboard.js';
import {
  clickOffered,
  pageShows,
} from '../../../../_shared/page/judged/seen.mjs';
import { cid, keywords, norm } from './settings.mjs';
import { customerIdPattern } from '../request.mjs';
import { preferredGoogleAdsEmail } from './sign_in.mjs';
import {
  buildGoogleAdsPath,
  summarizeKeywordPlannerResponses,
} from './capture.mjs';
import { collectDom, parseKeywordRows } from './dom.mjs';

/** Clicks the control `description` names when the page offers it. */
export async function clickByText(page, description, label) {
  const clicked = await clickOffered(page, description);
  if (clicked) console.log(`[google-ads-keyword-planner] clicked ${label}`);
  return clicked;
}

function plannerShown(page) {
  return pageShows(
    page,
    'Is the Google Ads Keyword Planner shown, offering to discover new keywords, get search volume and forecasts, or listing keyword ideas?',
  );
}

// Google Ads asks which account to open on its account selector route.
function onAccountSelector(url) {
  const { hostname, pathname } = new URL(url);
  return (
    hostname === 'ads.google.com' && pathname.startsWith('/nav/selectaccount')
  );
}

export async function continueFromGoogleAdsAccountSelector(page) {
  if (!onAccountSelector(page.url())) return false;
  const account = page
    .getByText(customerIdPattern(cid))
    .filter({ visible: true })
    .first();
  if (!(await account.isVisible())) return false;
  console.log(`[google-ads-keyword-planner] selecting Google Ads account ${cid}`);
  await humanClickLocator(page, account);
  await pageSettled(page);
  return true;
}

// The keyword box is the planner form's text area; the website field beside
// it is a single-line input.
export async function fillKeywordInput(page) {
  const text = keywords.join('\n');
  const box = page.locator('textarea').filter({ visible: true }).first();
  if (!(await box.isVisible()))
    return { ok: false, reason: 'no_keyword_input' };
  await humanFill(page, box, text);
  await pageSettled(page);
  console.log('[google-ads-keyword-planner] filled keyword input');
  return { ok: true, tag: 'textarea' };
}

export async function openKeywordPlanner(s) {
  const candidates = [
    '/aw/keywordplanner/home',
    '/aw/keywordplanner/ideas/new',
    '/aw/keywordplanner/ideas',
    '/aw/keywordplanner',
  ];
  const attempts = [];
  for (const path of candidates) {
    const url = buildGoogleAdsPath(s.page.url(), path);
    await s.page.goto(url, { waitUntil: 'domcontentloaded' });
    await pageSettled(s.page);
    if (await continueFromGoogleAdsAccountSelector(s.page)) {
      await pageSettled(s.page);
    }
    const dom = await collectDom(s.page);
    const matched = await plannerShown(s.page);
    attempts.push({
      path,
      url: dom.url || url,
      matched,
      textPreview: norm(dom.text),
      controls: dom.controls,
    });
    if (matched) return { ok: true, path, attempts };
  }
  const clickedTools = await clickByText(
    s.page,
    'the Tools or Planning menu of Google Ads',
    'tools/planning navigation',
  );
  if (clickedTools) {
    await clickByText(
      s.page,
      'the Keyword Planner entry of the open menu',
      'Keyword Planner',
    );
    await pageSettled(s.page);
    const dom = await collectDom(s.page);
    const matched = await plannerShown(s.page);
    attempts.push({
      path: 'menu_keyword_planner',
      url: dom.url,
      matched,
      textPreview: norm(dom.text),
      controls: dom.controls,
    });
    if (matched) return { ok: true, path: 'menu_keyword_planner', attempts };
  }
  return { ok: false, attempts };
}

export async function collectKeywordPlanner(s, captured) {
  const before = await collectDom(s.page);
  await clickByText(
    s.page,
    'the control that gets search volume and forecasts (or discovers new keywords) for a list of keywords',
    'keyword planner mode',
  );
  await pageSettled(s.page);
  const fill = await fillKeywordInput(s.page);
  const clicked = await clickByText(
    s.page,
    'the button that submits the entered keywords to get their results',
    'get results',
  );
  const actionClicks = [{ label: 'get results', clicked }];
  await pageSettled(s.page);
  const after = await collectDom(s.page);
  const rows = [...before.rows, ...after.rows];
  const parsedRows = parseKeywordRows(rows);
  return {
    customer: cid,
    preferredEmail: preferredGoogleAdsEmail(),
    keywords,
    url: s.page.url(),
    capturedAt: new Date().toISOString(),
    fill,
    actionClicks,
    rows: after.rows,
    controls: after.controls,
    parsedRows,
    visibleTextPreview: norm(after.text),
    rpc: summarizeKeywordPlannerResponses(captured.responses),
    capturedRequestCount: captured.requests.length,
    capturedResponseCount: captured.responses.length,
    source: 'google_ads_keyword_planner_ui',
  };
}
