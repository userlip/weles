// How long the research runs and what it found. The saturation loop keeps
// asking the model router which paid-search intents are still uncovered, runs
// each new batch of seed keywords through Keyword Planner, merges the metric
// rows it gets back, and stops when the router says the intents are covered or
// offers nothing new. The rows are reported as Google's planner gave them; no
// score of our own is put on them.

import { normalizeKeyword } from './request_intake.mjs';
import { runKeywordPlanner } from './keeper_harvest.mjs';
import { generateKeywordsWithRouter } from './model_router.mjs';

function uniqueKeywords(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const keyword = normalizeKeyword(value);
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

function mergeRows(existingRows, newRows) {
  const byKeyword = new Map(
    existingRows.map((row) => [
      normalizeKeyword(row.keyword).toLowerCase(),
      row,
    ]),
  );
  for (const row of newRows) {
    const key = normalizeKeyword(row.keyword).toLowerCase();
    if (!key || byKeyword.has(key)) continue;
    byKeyword.set(key, row);
  }
  return [...byKeyword.values()];
}

export async function runKeywordReport(input, generation) {
  let keywords = uniqueKeywords([
    ...input.seedKeywords,
    ...generation.keywords,
  ]);
  if (!keywords.length) throw new Error('no keyword candidates to check');

  const generations = [generation];
  const rounds = [];
  const checkedKeywords = [];
  const checkedKeys = new Set();
  let rows = [];
  let lastRun = null;
  let accountEmail = null;
  let capturedAt = null;
  let url = null;
  let stdout = '';
  let stderr = '';
  let saturated = Boolean(generation.saturated);
  let saturationRationale = generation.rationale;
  let saturationReason = saturated ? 'model_reports_intents_covered' : null;

  for (;;) {
    const pendingKeywords = keywords.filter(
      (keyword) => !checkedKeys.has(keyword.toLowerCase()),
    );
    if (pendingKeywords.length) {
      const run = await runKeywordPlanner({
        ...input,
        keywords: pendingKeywords,
      });
      lastRun = run;
      for (const keyword of pendingKeywords) {
        checkedKeys.add(keyword.toLowerCase());
        checkedKeywords.push(keyword);
      }

      const { report } = run;
      const roundRows = report?.rows ? report.rows : [];
      rows = mergeRows(rows, roundRows);
      if (report?.accountEmail) accountEmail = report.accountEmail;
      if (report?.capturedAt) capturedAt = report.capturedAt;
      if (report?.url) url = report.url;

      rounds.push({
        keywords: pendingKeywords,
        ok: Boolean(run.ok),
        exitCode: run.exitCode,
        rowCount: roundRows.length,
        blocked: report?.blocked ? report.blocked : null,
        resultFile: run.resultFile,
      });
      stdout += `\n--- saturation round ${rounds.length} stdout ---\n${run.stdout}`;
      stderr += `\n--- saturation round ${rounds.length} stderr ---\n${run.stderr}`;
    }

    if (saturated) break;

    const nextGeneration = await generateKeywordsWithRouter(input, {
      checkedKeywords,
      rows,
    });
    generations.push(nextGeneration);
    saturated = Boolean(nextGeneration.saturated);
    saturationRationale = nextGeneration.rationale;
    if (saturated) saturationReason = 'model_reports_intents_covered';
    const nextKeywords = uniqueKeywords(nextGeneration.keywords).filter(
      (keyword) =>
        !keywords.some(
          (existing) => existing.toLowerCase() === keyword.toLowerCase(),
        ),
    );
    if (!nextKeywords.length) {
      saturated = true;
      saturationReason = 'model_offered_no_unchecked_keyword';
      break;
    }
    keywords = uniqueKeywords([...keywords, ...nextKeywords]);
  }

  const uncheckedKeywords = keywords.filter(
    (keyword) => !checkedKeys.has(keyword.toLowerCase()),
  );
  return {
    ok: Boolean(rows.length),
    exitCode: lastRun ? lastRun.exitCode : null,
    resultFile: lastRun ? lastRun.resultFile : null,
    stdout,
    stderr,
    report: {
      ok: Boolean(rows.length),
      source: 'google_ads_keyword_planner_saturation_report',
      session: input.session,
      customer: input.customerId,
      accountEmail,
      keywords,
      checkedKeywords,
      uncheckedKeywords,
      rows,
      capturedAt,
      url,
      rounds,
      generations,
      saturated,
      saturationReason,
      saturationRationale,
    },
  };
}

export function buildKeywordReport(input, generation, run) {
  const { report } = run;
  return {
    ok: Boolean(run.ok),
    source: 'weles_keyword_report',
    customer: input.customerId,
    accountEmail: report.accountEmail,
    subject: input.subject,
    product: input.product,
    niche: input.niche,
    audience: input.audience,
    generated: generation,
    generations: report.generations,
    saturated: report.saturated,
    saturationReason: report.saturationReason,
    saturationRationale: report.saturationRationale,
    metrics: {
      ok: report.ok,
      rowCount: report.rows.length,
      checkedKeywordCount: report.checkedKeywords.length,
      uncheckedKeywordCount: report.uncheckedKeywords.length,
      roundCount: report.rounds.length,
      capturedAt: report.capturedAt,
      url: report.url,
    },
    checkedKeywords: report.checkedKeywords,
    uncheckedKeywords: report.uncheckedKeywords,
    rounds: report.rounds,
    rows: report.rows,
    plannerReport: report,
  };
}
