// Analyze operator-provided text in Pangram's dashboard.
//
// Input precedence:
//   PANGRAM_TEXT > SVC_TEXT > TEXT > PANGRAM_TEXT_FILE > TEXT_FILE > MESSAGE_FILE
// PANGRAM_NO_ACCOUNT=1 uses Pangram's public checker instead of the pool.
//
// Each attempt runs with one account of the pool (./analyze_text/attempt.mjs).
// An account Pangram answers has no credits left is marked exhausted for the
// day and the next attempt takes another, so the attempts end when the pool
// (and the stated auto-register budget) does. Every attempt's verdict is kept
// through the shared verdict writer; the result is in pangram_result.json.
//
// Output:
//   recordings/<run>/<action>/pangram_result.json
//   recordings/<run>/<action>/ban_signal.json
import { LABEL, dashboardUrl, inputText, textStats } from './analyze_text/scan_brief.mjs';
import { analyzeOnce } from './analyze_text/attempt.mjs';
import { keepVerdict } from '../_shared/action/verdict.mjs';

const text = inputText();
if (!text.trim())
  throw new Error(
    'PANGRAM_TEXT_REQUIRED: text required via PANGRAM_TEXT, SVC_TEXT, TEXT, PANGRAM_TEXT_FILE, TEXT_FILE, or MESSAGE_FILE',
  );
// The result is read from Pangram's own answers, so their bodies are kept.
process.env.WELES_CAPTURE_RESPONSE_BODIES = '1';
const label = process.env.ACTION ? process.env.ACTION : LABEL;
const request = {
  text,
  stats: textStats(text),
  url: dashboardUrl(),
  noAccount: process.env.PANGRAM_NO_ACCOUNT === '1',
};

let outcome;
do {
  outcome = await analyzeOnce(request);
  let unkept;
  try {
    await keepVerdict(label, outcome.acct, outcome.banSignal, {
      account_pool: outcome.selection ? outcome.selection.pool : null,
      account_usage: outcome.usage,
    });
  } catch (keepError) {
    unkept = keepError;
  }
  if (unkept)
    throw outcome.failure
      ? new AggregateError([outcome.failure, unkept], `${outcome.failure.message}; and its verdict was not kept: ${unkept.message}`)
      : unkept;
} while (outcome.failure && outcome.retryAccount);
if (outcome.failure) throw outcome.failure;
