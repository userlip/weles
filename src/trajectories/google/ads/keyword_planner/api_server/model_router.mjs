// The keyword intents come from the model, never from a list we keep. The call
// goes through Weles' one model client (`callJeden`): Brama with this
// workload's alias and signed identity, or the provider a user without Brama
// names in WELES_MODEL_ENDPOINT and WELES_MODEL. This module holds the two
// prompts (open the research, or judge whether the intents are already
// saturated) and the reading of the JSON the model was asked to answer with.

import { callJeden } from '../../../../../../dist/agent/jeden.js';
import { normalizeKeyword } from './request_intake.mjs';

// Models wrap their JSON in prose or a code fence. The document is whatever sits
// between the first opening bracket of the outermost kind and its last closer,
// so an answer is read once, in one place, and is either that document or an
// error naming what came back instead.
function jsonDocument(text) {
  const brace = text.indexOf('{');
  const bracket = text.indexOf('[');
  const isArray = bracket >= 0 && (brace < 0 || bracket < brace);
  const open = isArray ? bracket : brace;
  const close = isArray ? text.lastIndexOf(']') : text.lastIndexOf('}');
  if (open < 0 || close <= open) return text;
  return text.slice(open, close + 1);
}

export function parseKeywordRouterResponse(raw) {
  const text = String(raw || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(jsonDocument(text));
  } catch (error) {
    throw new Error(
      `model-router did not answer with the keyword JSON shape: ${error?.message || error}; answer began: ${text}`,
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

export async function generateKeywordsWithRouter(input, state = null) {
  const prompt = state
    ? [
        'Continue Google Ads keyword research by checking intent saturation.',
        'Return ONLY valid JSON in this exact shape: {"saturated":true,"keywords":[],"rationale":"why"} or {"saturated":false,"keywords":["canonical keyword"],"rationale":"what intent is still missing"}.',
        'If all materially distinct paid-search intents are already covered, return saturated true and an empty keywords array.',
        'If coverage is incomplete, return one canonical Google Ads seed keyword for each materially uncovered intent.',
        'Do not include fixed counts, commentary, markdown, metrics, or near-duplicate variants of already checked intents.',
        'Avoid brands not present in the prompt and policy-sensitive/adult-explicit terms.',
        `Subject: ${input.subject || '(none)'}`,
        `Product: ${input.product || '(none)'}`,
        `Niche: ${input.niche || '(none)'}`,
        `Audience: ${input.audience || '(none)'}`,
        `Landing page: ${input.landingPage || '(none)'}`,
        `Goal: ${input.goal}`,
        `Seed keywords: ${input.seedKeywords.join(', ') || '(none)'}`,
        `Already checked keywords: ${state.checkedKeywords.join(', ') || '(none)'}`,
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
        `Subject: ${input.subject || '(none)'}`,
        `Product: ${input.product || '(none)'}`,
        `Niche: ${input.niche || '(none)'}`,
        `Audience: ${input.audience || '(none)'}`,
        `Landing page: ${input.landingPage || '(none)'}`,
        `Goal: ${input.goal}`,
        `Seed keywords: ${input.seedKeywords.join(', ') || '(none)'}`,
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
