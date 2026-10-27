// One market-data scrape, shared by the Unusual Whales, VolumeLeaders and
// TradingView scrapers. The run is asked for a symbol (TICKER) and one page
// (PAGE) or several (PAGES, comma-separated), each a key of the site's page
// catalog; the worker sets them from the action's params, and a hand run
// states them the same way (`node --env-file=.env ...` for the site login).
// One session goes through the stated proxy and signs in once with the site's
// own sign-in. Each page is opened by the site's address for it, its whole
// content (inner scroll areas included) is kept as a screenshot in the run's
// recordings, its tables, chart series and text are read, and the result is
// persisted through the Trading Tools ingest (persistContext). A page that
// fails is reported with its cause, the remaining pages still run, and the
// failed ones fail the run's exit status. The run's answer is one JSON line
// on stdout; progress goes to stderr.
import { join } from 'node:path';
import { WSession } from '../../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';
import { statedProxy, statedText } from '../inputs/stated.mjs';
import { pageSettled } from '../page/settled.mjs';
import { persistContext } from './persist.mjs';

/** The symbol and the catalog pages this run is asked for. */
function marketRequest(site, code, catalog) {
  const ticker = statedText(
    ['TICKER'],
    `the symbol ${site} is scraped for`,
  ).toUpperCase();
  const pages = process.env.PAGES
    ? process.env.PAGES.split(',')
        .map((page) => page.trim())
        .filter(Boolean)
    : [
        statedText(
          ['PAGE'],
          `the ${site} page scraped (or PAGES, comma-separated)`,
        ),
      ];
  const unknown = pages.filter((page) => !Object.hasOwn(catalog, page));
  if (unknown.length)
    throw new Error(
      `${code}_PAGE_UNKNOWN: ${unknown.join(', ')} not in the page catalog (${Object.keys(catalog).join(', ')})`,
    );
  return { ticker, pages };
}

/** A screenshot of the page's whole content: the viewport grown to its tallest scroll area, then restored. */
async function captureWholeContent(page, path) {
  const viewport = page.viewportSize();
  const height = await page.evaluate(() =>
    Math.max(
      ...[document.documentElement, ...document.querySelectorAll('*')].map(
        (node) => node.scrollHeight,
      ),
    ),
  );
  if (height > viewport.height)
    await page.setViewportSize({ width: viewport.width, height });
  await pageSettled(page);
  await page.screenshot({ path });
  if (height > viewport.height) await page.setViewportSize(viewport);
}

/** What the page shows as data: its tables, its charts' series and labels, and its text. */
function readMarketPage(page) {
  return page.evaluate(() => {
    const text = (node) => node.textContent.trim();
    const highcharts = window.Highcharts && window.Highcharts.charts;
    return {
      url: location.href,
      title: document.title,
      tables: Array.from(document.querySelectorAll('table'), (table) => ({
        headers: Array.from(table.querySelectorAll('thead th, thead td'), text),
        rows: Array.from(table.querySelectorAll('tbody tr'), (row) =>
          Array.from(row.querySelectorAll('td, th'), text),
        ),
      })),
      svgSeries: Array.from(document.querySelectorAll('svg'), (svg) => ({
        textLabels: Array.from(svg.querySelectorAll('text'), text).filter(
          Boolean,
        ),
        ariaLabels: Array.from(svg.querySelectorAll('[aria-label]'), (node) =>
          node.getAttribute('aria-label'),
        ),
      })),
      highcharts: highcharts
        ? highcharts.filter(Boolean).map((chart) =>
            chart.series.map((series) => ({
              name: series.name,
              data: series.data.map((point) => ({ x: point.x, y: point.y })),
            })),
          )
        : null,
      bodyText: document.body.innerText,
    };
  });
}

/**
 * @param {object} scrape
 * @param {string} scrape.site     the site's name, as errors and the proxy statement say it
 * @param {string} scrape.code     the prefix of the site's error codes
 * @param {string} scrape.label    the run's label and its recordings directory
 * @param {Record<string, unknown>} scrape.catalog the site's pages, by the keys a request names
 * @param {(s: object) => Promise<void>} [scrape.signIn] the site's sign-in, when its pages need one
 * @param {(s: object, ticker: string, page: string) => Promise<string> | string} scrape.urlFor the site's address for a page
 * @param {(page: string) => string} scrape.rowPage the page name the persisted row carries
 */
export async function runMarketScrape(scrape) {
  const { ticker, pages } = marketRequest(
    scrape.site,
    scrape.code,
    scrape.catalog,
  );
  const s = await WSession.start({
    label: `${scrape.label}_${ticker}`,
    proxy: statedProxy(`the ${scrape.site} scrape`),
  });
  const results = [];
  try {
    if (scrape.signIn) await scrape.signIn(s);
    for (const page of pages) {
      try {
        const url = await scrape.urlFor(s, ticker, page);
        console.error(`[${scrape.label}] ${page} -> ${url}`);
        await s.goto(url);
        await pageSettled(s.page);
        const screenshotPath = join(
          runRecordingsDir(scrape.label),
          `${ticker}_${page}.png`,
        );
        await captureWholeContent(s.page, screenshotPath);
        const data = await readMarketPage(s.page);
        const persisted = await persistContext({
          ticker,
          page: scrape.rowPage(page),
          data,
          screenshotPath,
          metadata: { source: scrape.label },
        });
        console.error(`[${scrape.label}] ${page} persisted ${persisted.id}`);
        results.push({ page, url: data.url, stock_context: persisted });
      } catch (error) {
        console.error(`[${scrape.label}] ${page} failed: ${error.message}`);
        results.push({ page, error: error.message });
      }
    }
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = exitStatusFor(error);
  } finally {
    await s.close();
  }
  process.stdout.write(`${JSON.stringify({ ticker, pages, results })}\n`);
  const failed = results.filter((result) => result.error);
  if (failed.length && !process.exitCode) {
    const error = new Error(
      `${scrape.code}_PAGES_FAILED: ${failed.map((result) => `${result.page} (${result.error})`).join('; ')}`,
    );
    console.error(`FAIL: ${error.message}`);
    process.exitCode = exitStatusFor(error);
  }
}
