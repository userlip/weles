// The keyword intents come from the model, never from a list we keep. The call
// goes through Weles' one model client (`callJeden`): Brama with this
// workload's alias and signed identity, or the provider a user without Brama
// names in WELES_MODEL_ENDPOINT and WELES_MODEL. This module holds the two
// prompts (open the research, or judge whether the intents are already
// saturated) and the reading of the JSON the model was asked to answer with.
// A prompt carries only the facts the request stated; an absent one is left
// out rather than written as a placeholder.

import { callJeden } from '../../../../../../dist/agent/jeden.js';
import { normalizeKeyword } from './request_intake.mjs';

// Models wrap their JSON in prose or a code fence. The document is whatever
// sits between the first opening bracket and the last closing one, so an
// answer is read once, in one place, and is either that document or an error
// naming what came back instead.
function jsonDocument(text) {
  const document = text.match(/[[{][\s\S]*[\]}]/);
  return document ? document.shift() : text;
}

export function parseKeywordRouterResponse(raw) {
  if (typeof raw !== 'string')
    throw new Error(
      `model-router answered no text: ${JSON.stringify(raw)}`,
    );
  const text = raw.trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonDocument(text));
  } catch (error) {
    throw new Error(
      `model-router did not answer with the keyword JSON shape: ${error.message}; answer began: ${text}`,
    );
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.keywords;
  if (!Array.isArray(list))
    throw new Error(`model-router answer carried no keywords array: ${text}`);
  return {
    saturated: Boolean(parsed.saturated),
    keywords: [...new Set(list.map(normalizeKeyword).filter(Boolean))],
    intents: Array.isArray(parsed.intents)
      ? parsed.intents
      : Array.isArray(parsed.clusters)
        ? parsed.clusters
        : [],
    rationale: typeof parsed.rationale === 'string' ? parsed.rationale : null,
  };
}

/** The request's stated facts, one line each; absent ones are left out. */
function requestFacts(input) {
  return [
    ['Subject', input.subject],
    ['Product', input.product],
    ['Niche', input.niche],
    ['Audience', input.audience],
    ['Landing page', input.landingPage],
    ['Goal', input.goal],
    ['Seed keywords', input.seedKeywords.join(', ')],
  ]
    .filter(([, value]) => value)
    .map(([name, value]) => `${name}: ${value}`);
}

export async function generateKeywordsWithRouter(input, state = null) {
  const prompt = state
    ? [
        'Continue Google Ads keyword research by checking intent saturation.',
        'Return ONLY valid JSON in this exact shape: {"saturated":true,"keywords":[],"rationale":"why"} or {"saturated":false,"keywords":["canonical keyword"],"rationale":"what intent is still missing"}.',
        'If all materially distinct paid-search intents are already covered, return saturated true and an empty keywords array.',
        'If coverage is incomplete, return one canonical Google Ads seed keyword for each materially uncovered intent.',
        'Do not include fixed counts, commentary, markdown, metrics, or near-duplicate variants of already checked intents.',
        'Avoid brands not present in the prompt and policy-sensitive/adult-explicit terms.',
        ...requestFacts(input),
        ...(state.checkedKeywords.length
          ? [`Already checked keywords: ${state.checkedKeywords.join(', ')}`]
          : []),
        `Metric rows found: ${JSON.stringify(
          state.rows.map((row) => ({
            keyword: row.keyword,
            avgMonthlySearches: row.avgMonthlySearches,
            competition: row.competition,
            yoyChange: row.yoyChange,
          })),
        )}`,
      ].join('\n')
    : [
        'Identify the materially distinct paid-search intents for this product.',
        'Return ONLY valid JSON in this exact shape: {"saturated":false,"keywords":["canonical keyword"],"rationale":"coverage plan"}.',
        'Each keyword must be a canonical Google Ads seed keyword representing a different intent.',
        'Do not include fixed counts, commentary, markdown, metrics, or near-duplicate long-tail variants.',
        ...requestFacts(input),
        'Prefer commercial-intent search phrases. Avoid brands not present in the prompt and policy-sensitive/adult-explicit terms.',
      ].join('\n');
  const routed = await callJeden(prompt);
  const raw = routed.raw;
  const parsed = parseKeywordRouterResponse(raw);
  if (!parsed.saturated && !parsed.keywords.length)
    throw new Error(
      `model-router returned no parseable keywords: ${String(raw)}`,
    );
  return {
    ok: true,
    source: 'model-router',
    model: routed.model,
    routerHost: new URL(routed.routerUrl).host,
    saturated: parsed.saturated,
    keywords: parsed.keywords,
    intents: parsed.intents,
    rationale: parsed.rationale,
  };
}
