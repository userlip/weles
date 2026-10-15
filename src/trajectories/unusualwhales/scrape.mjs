// Scrape Unusual Whales pages for a symbol through the shared market scrape
// (../_shared/market/scrape.mjs): TICKER, and PAGE or PAGES (comma-separated)
// from the catalog below. The session signs in with the Unusual Whales login
// (UW_EMAIL, UW_PASSWORD, both required) through ./session/login.mjs. Dated
// pages carry the window the run states (START_DATE, END_DATE; a start alone
// is that one day); without one, Unusual Whales shows its own current window.
//
// Every path is one the authenticated Unusual Whales sidebar links to; a page
// it does not link answers 404.
import { runMarketScrape } from '../_shared/market/scrape.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { loginUnusualWhales } from './session/login.mjs';

const ORIGIN = 'https://unusualwhales.com';
// The page's path, and whether it takes the stated date window.
const PAGES = {
  option_flow_alerts: { path: '/option-flow-alerts?ticker_symbol={ticker}', dated: false },
  overview: { path: '/stock/{ticker}/overview', dated: true },
  chart: { path: '/stock/{ticker}/chart', dated: true },
  flow_alerts: { path: '/stock/{ticker}/flow-alerts', dated: true },
  flow_history: { path: '/stock/{ticker}/options-flow-history', dated: true },
  flow_overview: { path: '/stock/{ticker}/flow-overview', dated: true },
  net_premium: { path: '/stock/{ticker}/net-premium', dated: true },
  nope: { path: '/stock/{ticker}/nope', dated: true },
  darkpool: { path: '/stock/{ticker}/darkpool', dated: true },
  greeks: { path: '/stock/{ticker}/greeks', dated: false },
  greek_exposure: { path: '/stock/{ticker}/greek-exposure', dated: false },
  chains: { path: '/stock/{ticker}/option-chains', dated: false },
  oi_changes: { path: '/stock/{ticker}/open-interest-changes', dated: false },
  options_charting: { path: '/stock/{ticker}/options-charting', dated: false },
  volatility: { path: '/stock/{ticker}/volatility', dated: false },
  insiders: { path: '/stock/{ticker}/insiders', dated: false },
  institutions: { path: '/stock/{ticker}/institutions', dated: false },
  shorts: { path: '/stock/{ticker}/shorts', dated: false },
  analysts: { path: '/stock/{ticker}/analysts', dated: false },
  earnings: { path: '/stock/{ticker}/earnings', dated: false },
  dividends: { path: '/stock/{ticker}/dividends', dated: false },
  financials: { path: '/stock/{ticker}/financials', dated: false },
  risk: { path: '/stock/{ticker}/risk', dated: false },
  seasonality: { path: '/stock/{ticker}/seasonality', dated: false },
  stock_talk: { path: '/stock/{ticker}/stock-talk', dated: false },
};

function pageUrl(ticker, page) {
  const url = new URL(PAGES[page].path.replace('{ticker}', encodeURIComponent(ticker)), ORIGIN);
  const { START_DATE: start, END_DATE: end } = process.env;
  if (PAGES[page].dated && start) {
    url.searchParams.set('start_date', start);
    url.searchParams.set('end_date', end ? end : start);
  }
  return url.href;
}

await runMarketScrape({
  site: 'Unusual Whales',
  code: 'UW',
  label: 'uw_scrape',
  catalog: PAGES,
  signIn: (s) =>
    loginUnusualWhales(
      s,
      statedText(['UW_EMAIL'], 'the Unusual Whales login email'),
      statedText(['UW_PASSWORD'], 'the Unusual Whales login password'),
    ),
  urlFor: (s, ticker, page) => pageUrl(ticker, page),
  rowPage: (page) => page,
});
