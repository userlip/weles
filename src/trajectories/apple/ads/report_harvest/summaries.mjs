// The captured responses and requests, reduced to what the report says. The
// session's response ledger holds every host the page talked to; the ones
// Apple Ads itself answered are kept, each with its whole body.
import { norm } from './session.mjs';

const APPLE_ADS_HOST = 'app-ads.apple.com';

export function sanitizeResponses(responses) {
  return responses
    .filter((response) => new URL(response.url).hostname === APPLE_ADS_HOST)
    .map((response) => ({
      ts: response.ts,
      method: response.method,
      url: response.url,
      status: response.status,
      contentType: response.headers['content-type'],
      bodyLength: response.body.length,
      bodyPreview: response.body,
    }));
}

export function summarizeReport(pageState, responses) {
  const text = norm(pageState.text);
  const totalsMatch = text.match(
    /TOTALS\s+(\$[\d,.]+)\s+(\$[\d,.]+)\s+(\$[\d,.]+)\s+(\$[\d,.]+)/i,
  );
  // The report table's rows, by the table's own structure; the totals row is
  // the one the totals pattern read above.
  const campaigns = pageState.rows
    .filter((row) => row.tableRow)
    .map((row) => norm(row.text));
  return {
    url: pageState.url,
    title: pageState.title,
    totals: totalsMatch ? capturedGroups(totalsMatch) : [],
    campaignRows: campaigns,
    relevantResponseCount: responses.length,
    relevantResponseUrls: [
      ...new Set(responses.map((response) => response.url)),
    ],
  };
}

/** A match's captured groups, without the whole match ahead of them. */
function capturedGroups([, ...groups]) {
  return groups;
}

/**
 * A captured GraphQL request or response body read as JSON; a missing body is
 * none. Apple's GraphQL endpoint answers JSON, so a body that does not parse is
 * refused with the URL it came from and the parser's reason, instead of being
 * summarised as a request with no operations.
 */
function readBody(text, url) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Apple Ads captured a body from ${url} that is not JSON: ${error.message}`,
      { cause: error },
    );
  }
}

export function summarizeGraphqlRequests(requests) {
  return requests.map((request) => {
    const parsed = readBody(request.postData, request.url);
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return {
      ts: request.ts,
      method: request.method,
      url: request.url,
      operations: rows.map((row) => ({
        operationName: row.operationName,
        variables: row.variables,
        queryPreview:
          typeof row.query === 'string' ? row.query.replace(/\s+/g, ' ') : null,
      })),
    };
  });
}

// A response that declares another content type (an error page from the edge)
// is summarised by its preview; only one that declares JSON is read as JSON.
export function summarizeGraphqlResponses(responses) {
  return responses.map((response) => {
    const parsed = String(response.contentType).includes('json')
      ? readBody(response.body, response.url)
      : null;
    return {
      ts: response.ts,
      method: response.method,
      url: response.url,
      status: response.status,
      contentType: response.contentType,
      bodyLength: response.body.length,
      keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
      preview: response.body,
    };
  });
}

export function getCampaignReportPayload(requests) {
  for (const request of requests.slice().reverse()) {
    const parsed = readBody(request.postData, request.url);
    if (
      parsed?.operationName === 'getReportsByCampaign' &&
      parsed?.query &&
      parsed?.variables?.reportOptions?.filter
    ) {
      return parsed;
    }
  }
  return null;
}
