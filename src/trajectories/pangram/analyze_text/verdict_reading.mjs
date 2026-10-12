// How we know what the verdict is. Pangram answers a scan through its
// classify-text-sliding-window status API; the fractions it returns are the
// verdict, read from the live capture or, when the run only left recordings,
// from the same traffic in the recording files. A page that asks to sign up or
// log in instead of showing a result is judged by the vision model and named.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { LABEL } from './scan_brief.mjs';
import { pageCondition, pageSettled } from '../../_shared/page/settled.mjs';
import { pageShows } from '../../_shared/page/judged/seen.mjs';

const CLASSIFY_STATUS = '/classify-text-sliding-window/status';

function normalizePercent(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return Math.round(value * 10_000) / 100;
  if (value >= 0 && value <= 100) return Math.round(value * 100) / 100;
  return null;
}

function extractFromPangramClassify(parsed) {
  const task = Array.isArray(parsed?.tasks)
    ? parsed.tasks.find(
        (t) => t?.status === 'success' && t?.result?.response?.overall,
      )
    : null;
  const overall = task?.result?.response?.overall;
  if (!overall) return null;
  // The verdict is the class Pangram gave the largest share of the text.
  const shares = {
    ai_generated: normalizePercent(overall.fraction_ai),
    human: normalizePercent(overall.fraction_human),
    ai_assisted: normalizePercent(overall.fraction_ai_assisted),
  };
  const verdict = Object.entries(shares)
    .filter(([, share]) => share !== null)
    .sort(([, a], [, b]) => b - a)
    .map(([label]) => label)
    .shift();
  const aiPercent = normalizePercent(overall.fraction_ai);
  const humanPercent = normalizePercent(overall.fraction_human);
  const aiAssistedPercent = normalizePercent(overall.fraction_ai_assisted);
  const confidencePercent = normalizePercent(overall.avg_ai_likelihood);
  return {
    source: 'api',
    api_kind: 'classify-text-sliding-window',
    verdict,
    ai_percent: aiPercent,
    human_percent: humanPercent,
    ai_assisted_percent: aiAssistedPercent,
    avg_ai_likelihood_percent: confidencePercent,
    prediction: overall.prediction || null,
    prediction_short: overall.prediction_short || null,
    headline: overall.headline || null,
    textquery_uuid: task.result.textquery_uuid || null,
  };
}

function extractFromResponses(responses) {
  for (const r of [...responses].reverse()) {
    if (!String(r.url).includes(CLASSIFY_STATUS) || !r.body) continue;
    let parsed;
    try {
      parsed = JSON.parse(r.body);
    } catch {
      continue;
    }
    const result = extractFromPangramClassify(parsed);
    if (result)
      return { ...result, response_url: r.url, response_status: r.status };
  }
  return null;
}

function recordingResponsesFromFiles() {
  const responses = [];
  const dirs = [
    runRecordingsDir(LABEL),
    runRecordingsDir(process.env.ACTION || LABEL),
  ];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const filePath = join(dir, name);
      if (name === 'network.ndjson') {
        for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            const row = JSON.parse(line);
            responses.push({
              url: row.url,
              status: row.status,
              body: row.body,
            });
          } catch {
            // Ignore malformed network rows.
          }
        }
      }
      if (name === 'session.har') {
        try {
          const har = JSON.parse(readFileSync(filePath, 'utf8'));
          for (const entry of har?.log?.entries ?? []) {
            responses.push({
              url: entry?.request?.url,
              status: entry?.response?.status,
              body: entry?.response?.content?.text,
            });
          }
        } catch {
          // Ignore incomplete HAR snapshots.
        }
      }
    }
  }
  return responses;
}

function extractFromRecordedResponses() {
  const responses = recordingResponsesFromFiles();
  return responses.length ? extractFromResponses(responses) : null;
}

// Why Pangram walled the result: a pending signup check (its signup route
// carries the pending text), a login route, or a page that asks to sign up
// or log in first.
export function authRequiredState(finalUrl) {
  const { pathname, searchParams } = new URL(finalUrl);
  if (pathname.startsWith('/signup') && searchParams.has('pendingCheck'))
    return 'signup_pending_check';
  if (
    ['/login', '/signin', '/sign-in', '/auth', '/session', '/sso'].some(
      (route) => pathname.startsWith(route),
    )
  )
    return 'login_required';
  return 'signup_required_for_result';
}

/** The verdict from Pangram's API answer, waited for as long as the scan
 * takes; a page that walls the result behind a signup or login ends the wait
 * with a walled answer. */
export async function collectResult(s) {
  for (;;) {
    const apiResult =
      extractFromResponses(s.capturedResponses) ||
      extractFromRecordedResponses();
    if (apiResult) return apiResult;
    await pageSettled(s.page);
    const text = await s.page.evaluate(() => document.body.innerText);
    if (
      await pageShows(
        s.page,
        'Does the page ask to sign up or log in before it shows the scan result?',
      )
    )
      return { walled: true, body_text_sample: text };
    await Promise.any([
      s.page.waitForResponse((response) =>
        response.url().includes(CLASSIFY_STATUS),
      ),
      pageCondition(
        s.page,
        (previous) => document.body.innerText !== previous,
        text,
      ),
    ]);
  }
}
