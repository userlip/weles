// Reading the numbers off the planner table and writing them down. Each keyword
// this run asked about is looked up in the rendered text; the lines from it to
// the next of the run's keywords (or the end of the text) are its row, and its
// monthly searches, its two changes, its competition band and its top-of-page
// bids are read from them by what each cell is. The harvest record is what the
// caller of this runner reads; a planner that shows no rows is refused.

import {
  SESSION,
  cid,
  keywords,
  norm,
  preferredEmail,
  refuse,
  writeResult,
} from './run_brief.mjs';
import { evalState, idle, shows } from './keeper_browser.mjs';

const PERCENT_CHANGE = /^[-+]?\d+%$/;

/** Whether a table cell is a number, a percentage or an amount of money. */
function numericCell(line) {
  return /^[<>]?\s?[-+]?(?:US)?[$£€]?\s?\d[\d,.]*\s?%?$/.test(line);
}

function parseMoney(value) {
  const match = value.match(/(?:US)?\$\s?\d+(?:[,.]\d+)?/i);
  if (!match) return null;
  const [money] = match;
  return money.replace(/\s+/g, '');
}

/**
 * The lines that make up the row of `keyword`: the first line naming it and
 * the lines after it up to the next line naming another of the run's
 * keywords. The keyword's own cells come first, so each value is read from
 * the first cell of its kind. Null when no line names the keyword.
 */
function rowLines(lines, keyword) {
  const wanted = keyword.toLowerCase();
  const others = keywords
    .filter((other) => other !== keyword)
    .map((other) => other.toLowerCase());
  const row = [];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!row.length) {
      if (lower.includes(wanted)) row.push(line);
      continue;
    }
    if (others.some((other) => lower.includes(other))) break;
    row.push(line);
  }
  return row.length ? row : null;
}

export function parseRows(text) {
  const lines = text.split(/\r?\n/).map(norm).filter(Boolean);
  const rows = [];
  for (const keyword of keywords) {
    const row = rowLines(lines, keyword);
    if (!row) continue;
    const [named, ...cells] = row;
    const monthly = cells.find((line) => /^[\d,]+(?:\.\d+)?$/.test(line));
    const changes = cells.filter((line) => PERCENT_CHANGE.test(line));
    const [threeMonthChange = null, yoyChange = null] = changes;
    // The competition band is the column after the two changes, in the
    // planner's own words for it (any language): the first cell after the
    // last change that is not a number.
    const lastChange = cells.findLastIndex((line) => PERCENT_CHANGE.test(line));
    const afterChanges = changes.length
      ? cells.filter((line, i) => i > lastChange)
      : [];
    const [competition = null] = afterChanges.filter(
      (line) => !numericCell(line),
    );
    const [topOfPageBidLow = null, topOfPageBidHigh = null] = cells
      .map(parseMoney)
      .filter(Boolean);
    const impressionShare = cells.find((line) =>
      /^<?\s?\d+(?:\.\d+)?%$/.test(line),
    );
    rows.push({
      keyword: named,
      avgMonthlySearches: monthly ? Number(monthly.replace(/,/g, '')) : null,
      avgMonthlySearchesText: monthly ? monthly : null,
      threeMonthChange,
      yoyChange,
      competition,
      adImpressionShare: impressionShare ? impressionShare : null,
      topOfPageBidLow,
      topOfPageBidHigh,
      raw: row,
    });
  }
  return rows.filter(
    (row) =>
      row.avgMonthlySearchesText || row.competition || row.topOfPageBidLow,
  );
}

/**
 * The planner's answer once its page has settled: the result rows, or none
 * when the vision model sees the planner say it found none or failed. A
 * settled page showing neither is refused with what it shows.
 */
export async function waitForResults() {
  await idle();
  const state = await evalState();
  const rows = parseRows(state.text);
  if (rows.length) return { state, rows };
  if (
    await shows(
      'Does the Keyword Planner say it found no keywords or results, or show an error?',
    )
  )
    return { state, rows: [] };
  return refuse({
    blocked: 'keyword_planner_results_unread',
    customer: cid,
    keywords,
    url: state.url,
    text: norm(state.text),
  });
}

/** Write the harvest record; a planner that answered no rows is refused. */
export function writeKeywordReport(result, steps) {
  const report = {
    source: 'google_ads_keyword_planner_keeper_existing_window',
    session: SESSION,
    customer: cid,
    accountEmail: preferredEmail(),
    keywords,
    url: result.state.url,
    title: result.state.title,
    capturedAt: new Date().toISOString(),
    rows: result.rows,
    text: norm(result.state.text),
    steps,
  };
  if (!result.rows.length)
    refuse({ ...report, blocked: 'keyword_planner_no_rows' });
  writeResult({ ok: true, ...report });
}
