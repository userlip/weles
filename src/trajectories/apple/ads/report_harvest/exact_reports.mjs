// The exact-range campaign reports fetched through the page's own session, and the keep-open tail.
import { CLOSE_AFTER_HARVEST } from './settings.mjs';
import { reviewUntilClosed } from '../../../_shared/page/settled.mjs';

export async function fetchExactCampaignReports(page, templatePayload, ranges) {
  if (!ranges.length) return [];
  if (!templatePayload)
    throw new Error(
      `apple_ads_exact_reports_unavailable: ${ranges.length} exact range(s) were asked for, but the reports page issued no campaign report request to copy; no figures were read`,
    );
  return await page.evaluate(
    async ({ templatePayload, ranges }) => {
      const outputs = [];
      for (const range of ranges) {
        const payload = JSON.parse(JSON.stringify(templatePayload));
        payload.variables.reportOptions.filter.startTime = range.startTime;
        payload.variables.reportOptions.filter.endTime = range.endTime;
        payload.variables.reportOptions.filter.returnGrandTotals = true;
        payload.variables.reportOptions.filter.returnRowTotals = true;
        payload.variables.reportOptions.filter.selector =
          payload.variables.reportOptions.filter.selector || {};
        payload.variables.reportOptions.filter.selector.pagination = {
          offset: 0,
          limit: 100,
        };
        const res = await fetch('/reporting/graphql', {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const body = await res.text();
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {}
        outputs.push({
          label: range.label,
          startTime: range.startTime,
          endTime: range.endTime,
          status: res.status,
          ok: res.ok,
          body,
          json,
        });
      }
      return outputs;
    },
    { templatePayload, ranges },
  );
}

// A figure Apple did not return is unknown, not zero: it is reported as null
// so no reader takes a missing spend or install count for a real one.
function figure(value) {
  const raw = value?.amount ?? value;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n))
    throw new Error(
      `apple_ads_report_figure_unreadable: ${JSON.stringify(raw)}`,
    );
  return n;
}

// The currency Apple states for a money figure, or null when it states none.
function currencyOf(money) {
  return money?.currency ?? null;
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
    const data = report.json?.data?.reportingV5?.getReportsByCampaign;
    // A failed or unparsable range is a failed harvest, never a range of zeros.
    if (!report.ok || !Array.isArray(data?.row))
      throw new Error(
        `apple_ads_exact_report_failed: range ${report.label} (${report.startTime}..${report.endTime}) answered HTTP ${report.status} without campaign rows; errors: ${JSON.stringify(report.json?.errors ?? null)}`,
      );
    return {
      label: report.label,
      startTime: report.startTime,
      endTime: report.endTime,
      ok: report.ok,
      status: report.status,
      totalResults: data.pagination?.totalResults ?? null,
      totals: figures(data.grandTotals?.total),
      campaigns: data.row.map((row) => ({
        campaignId: row.metadata?.campaignId,
        campaignName: row.metadata?.campaignName,
        displayStatus: row.metadata?.displayStatus,
        servingStateReasons: row.metadata?.servingStateReasons ?? null,
        startDate: row.metadata?.startDate,
        endDate: row.metadata?.endDate,
        dailyBudget: figure(row.metadata?.dailyBudget),
        dailyBudgetCurrency: currencyOf(row.metadata?.dailyBudget),
        countriesOrRegions: row.metadata?.countriesOrRegions ?? null,
        supplySources: row.metadata?.supplySources ?? null,
        ...figures(row.total),
      })),
    };
  });
}

export async function keepOpen(session) {
  try {
    if (!CLOSE_AFTER_HARVEST && !session.page.isClosed()) {
      console.log(
        '[apple-ads-report-harvest] keeping browser open for review; close the window or stop the command to finish; APPLE_ADS_CLOSE_AFTER_HARVEST=1 skips review',
      );
      await reviewUntilClosed(session);
    }
  } finally {
    await session.close();
  }
}
