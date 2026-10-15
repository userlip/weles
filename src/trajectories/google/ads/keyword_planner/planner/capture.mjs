// The Google Ads URLs the planner opens and the keyword-planner responses it
// captures. Every Google Ads request and answer of the run is kept; an answer
// whose body cannot be read, or whose JSON does not parse, is kept with the
// error it gave, so the summary says what stayed unread.
import { cid, keywords, norm } from './settings.mjs';
import { preferredGoogleAdsEmail } from './sign_in.mjs';

const GOOGLE_ADS_HOST = 'ads.google.com';
const GOOGLE_ADS_ORIGIN = `https://${GOOGLE_ADS_HOST}`;
// The query parameters Google Ads carries the selected account and user in.
const ACCOUNT_PARAMS = [
  'ocid',
  'authuser',
  '__u',
  '__c',
  'uscid',
  'euid',
  'cid',
  '__e',
];
// Google prefixes its JSON answers with this guard against script inclusion.
const JSON_GUARD = /^\)\]\}'\s*\n?/;

export function campaignsUrl(paramName, customerId) {
  const url = new URL(`${GOOGLE_ADS_ORIGIN}/aw/campaigns`);
  url.searchParams.set(paramName, customerId);
  url.searchParams.set('authuser', preferredGoogleAdsEmail());
  return url.toString();
}

/** `pathname` on Google Ads, carrying the account parameters of `current`. */
export function buildGoogleAdsPath(current, pathname) {
  const source = new URL(current);
  const target = new URL(pathname, GOOGLE_ADS_ORIGIN);
  for (const key of ACCOUNT_PARAMS) {
    const value = source.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  target.searchParams.set('authuser', preferredGoogleAdsEmail());
  if (!target.searchParams.get('cid')) target.searchParams.set('cid', cid);
  return target.toString();
}

function onGoogleAds(url) {
  return new URL(url).hostname === GOOGLE_ADS_HOST;
}

export function installKeywordPlannerCapture(page) {
  const requests = [];
  const responses = [];
  page.on('request', (request) => {
    if (!onGoogleAds(request.url())) return;
    requests.push({ method: request.method(), url: request.url() });
  });
  page.on('response', (response) => {
    if (!onGoogleAds(response.url())) return;
    const { origin, pathname } = new URL(response.url());
    const entry = {
      method: response.request().method(),
      endpoint: `${origin}${pathname}`,
      status: response.status(),
      contentType: response.headers()['content-type'],
    };
    responses.push(entry);
    response.text().then(
      (body) => {
        entry.body = body;
      },
      (error) => {
        entry.unreadable = error.message;
      },
    );
  });
  return { requests, responses };
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function walk(value, visit, path) {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walk(item, visit, path.concat(String(index))),
    );
    return;
  }
  if (isObject(value)) {
    for (const [key, child] of Object.entries(value))
      walk(child, visit, path.concat(key));
  }
}

/**
 * What the captured answers say: how many each endpoint gave, which strings
 * name one of the run's keywords and which non-zero numbers they carry, and
 * which answers could not be read or parsed.
 */
export function summarizeKeywordPlannerResponses(responses) {
  const keywordMentions = [];
  const numericMentions = [];
  const unread = [];
  const keywordPatterns = keywords.map(
    (keyword) =>
      new RegExp(keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'),
  );

  for (const response of responses) {
    const { endpoint } = response;
    if (response.unreadable) {
      unread.push({ endpoint, error: response.unreadable });
      continue;
    }
    if (typeof response.body !== 'string') {
      unread.push({ endpoint, error: 'the body had not arrived' });
      continue;
    }
    if (!JSON_GUARD.test(response.body) && !/json/i.test(response.contentType))
      continue;
    let parsed;
    try {
      parsed = JSON.parse(response.body.replace(JSON_GUARD, ''));
    } catch (error) {
      unread.push({ endpoint, error: error.message });
      continue;
    }
    walk(
      parsed,
      (value, path) => {
        if (typeof value === 'string') {
          const compact = norm(value);
          if (keywordPatterns.some((pattern) => pattern.test(compact)))
            keywordMentions.push({ endpoint, path: path.join('.'), value: compact });
        }
        if (typeof value === 'number' && Number.isFinite(value) && value)
          numericMentions.push({ endpoint, path: path.join('.'), value });
      },
      [],
    );
  }

  return {
    responseCount: responses.length,
    endpointCounts: Object.fromEntries(
      Object.entries(Object.groupBy(responses, ({ endpoint }) => endpoint)).map(
        ([endpoint, hits]) => [endpoint, hits.length],
      ),
    ),
    keywordMentions,
    numericMentions,
    unread,
  };
}
