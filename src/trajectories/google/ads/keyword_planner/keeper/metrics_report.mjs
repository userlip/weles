// Reading the numbers off the planner table and writing them down. Each keyword
// this run asked about is looked up in the rendered text, the fourteen lines
// that follow it carry its monthly searches, its two changes, its competition
// band and its top-of-page bids, and the harvest record is what the caller of
// this runner reads.

import {
  SESSION,
  cid,
  dashedCustomerId,
  keywords,
  norm,
  preferredEmail,
  writeResult,
} from './run_brief.mjs';
import { evalState, idle, shows } from './keeper_browser.mjs';

/** Whether a table cell is a number, a percentage or an amount of money. */
function numericCell(line) {
  return /^[<>]?\s?[-+]?(?:US)?[$£€]?\s?\d[\d,.]*\s?%?$/.test(line);
}

function parseMoney(value) {
  const match = String(value || '').match(/(?:US)?\$\s?\d+(?:[,.]\d+)?/i);
  return match ? match[0].replace(/\s+/g, '') : null;
}

export function parseRows(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(norm)
    .filter(Boolean);
  const rows = [];
  for (const keyword of keywords) {
    const wanted = keyword.toLowerCase();
    const index = lines.findIndex(
      (line) =>
        line.toLowerCase() === wanted || line.toLowerCase().includes(wanted),
    );
    if (index < 0) continue;
    const window = lines.slice(index, index + 14);
    const monthly = window.find(
      (line, i) => i > 0 && /^\d{1,3}(?:,\d{3})*(?:\.\d+)?$/.test(line),
    );
    const changes = window.filter((line) => /^[-+]?\d+%$/.test(line));
    // The competition band is the column after the two changes, in the
    // planner's own words for it (any language): the first cell after the
    // last change that is not a number.
    const lastChange = window.findLastIndex((line) => /^[-+]?\d+%$/.test(line));
    const afterChanges = changes.length
      ? window.filter((line, i) => i > lastChange)
      : [];
    const [competition = null] = afterChanges.filter(
      (line) => !numericCell(line),
    );
    const bids = window.map(parseMoney).filter(Boolean);
    rows.push({
      keyword: window[0] || keyword,
      avgMonthlySearches: monthly ? Number(monthly.replace(/,/g, '')) : null,
      avgMonthlySearchesText: monthly || null,
      threeMonthChange: changes[0] || null,
      yoyChange: changes[1] || null,
      competition,
      adImpressionShare:
        window.find((line) => /^<?\s?\d+(?:\.\d+)?%$/.test(line)) || null,
      topOfPageBidLow: bids[0] || null,
      topOfPageBidHigh: bids[1] || null,
      raw: window,
    });
  }
  return rows.filter(
    (row) =>
      row.avgMonthlySearchesText || row.competition || row.topOfPageBidLow,
  );
}

// The planner is read until it shows result rows or the planner itself says it
// found none (or failed), which the vision model judges through the keeper;
// no count of reads is chosen here.
export async function waitForResults() {
  for (;;) {
    await idle('short');
    const s = await evalState();
    const rows = parseRows(s.text || '');
    if (rows.length) return { state: s, rows };
    if (
      await shows(
        'Does the Keyword Planner say it found no keywords or results, or show an error?',
      )
    )
      return { state: s, rows: [] };
  }
}

export function writeKeywordReport(result, steps) {
  const report = {
    ok: result.rows.length > 0,
    source: 'google_ads_keyword_planner_keeper_existing_window',
    session: SESSION,
    customer: cid,
    customerDashed: dashedCustomerId(cid),
    accountEmail: preferredEmail(),
    keywords,
    url: result.state?.url || '',
    title: result.state?.title || '',
    capturedAt: new Date().toISOString(),
    rows: result.rows,
    text: norm(result.state?.text || ''),
    steps,
  };
  writeResult(report, report.ok ? 0 : 7);
}
