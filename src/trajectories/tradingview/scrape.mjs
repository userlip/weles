// Scrape public TradingView symbol pages through the shared market scrape
// (../_shared/market/scrape.mjs): TICKER, and PAGE or PAGES (comma-separated)
// from the catalog below. No sign-in: these pages are public. The symbol's
// exchange is TradingView's own answer: /symbols/<TICKER>/ redirects to
// /symbols/<EXCHANGE>-<TICKER>/, and every page sits under that address.
import { runMarketScrape } from '../_shared/market/scrape.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

const ORIGIN = 'https://www.tradingview.com';
const SYMBOL_PATH = /^\/symbols\/(?<symbol>[A-Z]+-[A-Z\d.]+)\//;
// The symbol page's own sub-pages, by the path segment each sits at.
const PAGES = Object.fromEntries(
  [
    'technicals',
    'forecast',
    'financials-overview',
    'financials-income-statement',
    'financials-revenue',
    'financials-dividends',
    'analysis',
    'analysis-overview',
    'news',
    'ideas',
    'options-chain',
    'seasonals',
    'holdings',
    'etfs',
    'economic-calendar',
    'reports-history',
    'minds',
    'documents',
  ].map((segment) => [segment, `${segment}/`]),
);
PAGES.overview = '';

const symbols = new Map();

/** The exchange-qualified symbol TradingView redirects the bare ticker to. */
async function exchangeSymbol(s, ticker) {
  if (symbols.has(ticker)) return symbols.get(ticker);
  await s.goto(`${ORIGIN}/symbols/${encodeURIComponent(ticker)}/`);
  await pageSettled(s.page);
  const symbol = new URL(s.page.url()).pathname.match(SYMBOL_PATH)?.groups.symbol;
  if (!symbol) throw new Error(`TV_SYMBOL_UNRESOLVED: /symbols/${ticker}/ led to ${s.page.url()}, which names no exchange`);
  symbols.set(ticker, symbol);
  return symbol;
}

await runMarketScrape({
  site: 'TradingView',
  code: 'TV',
  label: 'tv_scrape',
  catalog: PAGES,
  urlFor: async (s, ticker, page) => `${ORIGIN}/symbols/${await exchangeSymbol(s, ticker)}/${PAGES[page]}`,
  rowPage: (page) => `tv_${page}`,
});
