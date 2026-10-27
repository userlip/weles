// The exact-range campaign reports fetched through the page's own session, and the keep-open tail.
import { CLOSE_AFTER_HARVEST } from './settings.mjs';
import { reviewUntilClosed } from '../../../_shared/page/navigation/review.mjs';

/** The answer's JSON, or the reason it is not JSON. */
function parsedAnswer(body) {
  let json;
  let parseError;
  try {
    json = JSON.parse(body);
  } catch (error) {
    parseError = error.message;
  }
  return parseError === undefined ? { json } : { parseError };
}

function rangeName(range) {
  return `${range.label} (${range.startTime}..${range.endTime})`;
}

export async function fetchExactCampaignReports(page, templatePayload, ranges) {
  if (!ranges.length) return [];
  if (!templatePayload)
    throw new Error(
      `apple_ads_exact_reports_unavailable: ranges ${ranges.map(rangeName).join(', ')} were asked for, but the reports page issued no campaign report request to copy; no figures were read`,
    );
  const outputs = [];
  for (const range of ranges) {
    const payload = structuredClone(templatePayload);
    payload.variables.reportOptions.filter.startTime = range.startTime;
    payload.variables.reportOptions.filter.endTime = range.endTime;
    payload.variables.reportOptions.filter.returnGrandTotals = true;
    payload.variables.reportOptions.filter.returnRowTotals = true;
    let response;
    try {
      // The page's own session sends the request; a fetch or body read that
      // fails rejects here with its cause.
      response = await page.evaluate(async (body) => {
        const res = await fetch('/reporting/graphql', {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        return { status: res.status, ok: res.ok, body: await res.text() };
      }, payload);
    } catch (cause) {
      throw new Error(
        `apple_ads_exact_report_fetch_failed: range ${rangeName(range)} yielded no observable HTTP result: ${cause.message}`,
        { cause },
      );
    }
    outputs.push({
      label: range.label,
      startTime: range.startTime,
      endTime: range.endTime,
      ...response,
      ...parsedAnswer(response.body),
    });
  }
  return outputs;
}

// A figure Apple did not return is unknown, not zero: it is reported as null
// so no reader takes a missing spend or install count for a real one.
function figure(value) {
  const raw =
    value !== null && typeof value === 'object' ? value.amount : value;
  if (raw === undefined || raw === null || raw === '') return null;
  if (!String(raw).trim()) return null;
  const number = Number(raw);
  if (
    !Number.isFinite(number) ||
    raw === true ||
    raw === false ||
    Array.isArray(raw)
  )
    throw new Error(
      `apple_ads_report_figure_unreadable: ${JSON.stringify(raw)}`,
    );
  return number;
}

// The currency Apple states for a money figure, or null when it states none.
function currencyOf(money) {
  const currency = money?.currency;
  if (currency === undefined || currency === null || currency === '')
    return null;
  if (typeof currency !== 'string' || !currency.trim())
    throw new Error(
      `apple_ads_report_currency_unreadable: ${JSON.stringify(currency)}`,
    );
  return currency;
}

function figures(total) {
  return {
    spend: figure(total?.localSpend),
    currency: currencyOf(total?.localSpend),
    impressions: figure(total?.impressions),
    taps: figure(total?.taps),
    installs: figure(total?.totalInstalls),
    newDownloads: figure(total?.totalNewDownloads),
    redownloads: figure(total?.totalRedownloads),
    avgCPT: figure(total?.avgCPT),
    avgCPM: figure(total?.avgCPM),
    avgCPI: figure(total?.totalAvgCPI),
    ttr: figure(total?.ttr),
    installRate: figure(total?.totalInstallRate),
  };
}

export function summarizeExactReports(exactReports) {
  return exactReports.map((report) => {
    const errors = report.json?.errors;
    const hasGraphqlErrors =
      errors !== undefined &&
      (!Array.isArray(errors) || Boolean(errors.length));
    const data = report.json?.data?.reportingV5?.getReportsByCampaign;
    if (
      !report.ok ||
      report.parseError ||
      hasGraphqlErrors ||
      !Array.isArray(data?.row)
    ) {
      const detail = [
        `GraphQL errors: ${errors === undefined ? 'not supplied' : JSON.stringify(errors)}`,
      ];
      if (report.parseError) detail.push(`JSON parse: ${report.parseError}`);
      if (!Array.isArray(data?.row)) detail.push('campaign rows missing');
      const response = `HTTP ${report.status}`;
      throw new Error(
        `apple_ads_exact_report_failed: range ${rangeName(report)} answered ${response}; ${detail.join('; ')}`,
      );
    }
    try {
      return {
        label: report.label,
        startTime: report.startTime,
        endTime: report.endTime,
        ok: report.ok,
        status: report.status,
        totalResults: data.pagination?.totalResults,
        totals: figures(data.grandTotals?.total),
        campaigns: data.row.map((row) => ({
          campaignId: row.metadata?.campaignId,
          campaignName: row.metadata?.campaignName,
          displayStatus: row.metadata?.displayStatus,
          servingStateReasons: row.metadata?.servingStateReasons,
          startDate: row.metadata?.startDate,
          endDate: row.metadata?.endDate,
          dailyBudget: figure(row.metadata?.dailyBudget),
          dailyBudgetCurrency: currencyOf(row.metadata?.dailyBudget),
          countriesOrRegions: row.metadata?.countriesOrRegions,
          supplySources: row.metadata?.supplySources,
          ...figures(row.total),
        })),
      };
    } catch (cause) {
      throw new Error(
        `apple_ads_exact_report_unreadable: range ${rangeName(report)} answered HTTP ${report.status}; GraphQL errors: ${errors === undefined ? 'not supplied' : JSON.stringify(errors)}; ${cause.message}`,
        { cause },
      );
    }
  });
}

export async function keepOpen(session, completed) {
  try {
    if (
      completed &&
      !process.env.ACTION_LOG_ID &&
      !CLOSE_AFTER_HARVEST &&
      !session.page.isClosed()
    ) {
      console.log(
        '[apple-ads-report-harvest] keeping browser open for review; close the window or stop the command to finish; APPLE_ADS_CLOSE_AFTER_HARVEST=1 skips review',
      );
      await reviewUntilClosed(session);
    }
  } finally {
    await session.close();
  }
}
