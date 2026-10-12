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
    /TOTALS\s+(\$[0-9,.]+)\s+(\$[0-9,.]+)\s+(\$[0-9,.]+)\s+(\$[0-9,.]+)/i,
  );
  // The report table's rows, by the table's own structure; the totals row is
  // the one the totals pattern read above.
  const campaigns = pageState.rows
    .filter((row) => row.tableRow)
    .map((row) => norm(row.text));
  return {
    url: pageState.url,
    title: pageState.title,
    totals: totalsMatch ? totalsMatch.slice(1) : [],
    campaignRows: campaigns,
    relevantResponseCount: responses.length,
    relevantResponseUrls: [
      ...new Set(responses.map((response) => response.url)),
    ],
  };
}

export function summarizeGraphqlRequests(requests) {
  return requests.map((request) => {
    let parsed = null;
    try {
      parsed = JSON.parse(request.postData || '{}');
    } catch {}
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return {
      ts: request.ts,
      method: request.method,
      url: request.url,
      operations: rows.map((row) => ({
        operationName: row.operationName,
        variables: row.variables,
        queryPreview: String(row.query || '').replace(/\s+/g, ' '),
      })),
    };
  });
}

export function summarizeGraphqlResponses(responses) {
  return responses.map((response) => {
    let parsed = null;
    try {
      parsed = JSON.parse(response.body || '{}');
    } catch {}
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
    try {
      const parsed = JSON.parse(request.postData || '{}');
      if (
        parsed?.operationName === 'getReportsByCampaign' &&
        parsed?.query &&
        parsed?.variables?.reportOptions?.filter
      ) {
        return parsed;
      }
    } catch {}
  }
  return null;
}
