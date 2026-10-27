// Scrape VolumeLeaders pages for a symbol through the shared market scrape
// (../_shared/market/scrape.mjs): TICKER, and PAGE or PAGES (comma-separated)
// from the catalog below. The session signs in with the VolumeLeaders login
// (VL_EMAIL, VL_PASSWORD, both required); a sign-in its captcha holds is
// solved through the session's solver and submitted once more. Dated pages
// cover START_DATE to END_DATE, each the run's own date when not stated.
//
// The addresses carry the full query VolumeLeaders' own sidebar produces: its
// grid templates inline every parameter into their data-table script, and a
// missing one breaks that script before the grid loads. The filters carry the
// values VolumeLeaders uses for "any" (no volume, price, dollar, rank or
// relative-size bound), and the level, trade-count and preset parameters are
// the ones its sidebar sets for each view, so no filter is chosen here.
import { runMarketScrape } from '../_shared/market/scrape.mjs';
import { statedText } from '../_shared/inputs/stated.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';

const ORIGIN = 'https://www.volumeleaders.com';
const ANY_SIZE =
  'MinVolume=0&MaxVolume=2000000000&MinPrice=0&MaxPrice=100000&MinDollars=0&MaxDollars=30000000000&VCD=0&RelativeSize=0';
const ALL_SESSIONS =
  'IncludePremarket=1&IncludeRTH=1&IncludeAH=1&IncludeOpening=1&IncludeClosing=1&IncludePhantom=1&IncludeOffsetting=1';
const ANY_PRINT =
  'DarkPools=-1&Sweeps=-1&LatePrints=-1&SignaturePrints=-1&EvenShared=-1&SecurityTypeKey=-1';
// Each page's path and query; {ticker}, {start} and {end} are the request's.
const PAGES = {
  trades: `/Trades?Tickers={ticker}&StartDate={start}&EndDate={end}&${ANY_SIZE}&${ANY_PRINT}&Conditions=&TradeRank=-1&TradeRankSnapshot=-1&MarketCap=-1&${ALL_SESSIONS}&SectorIndustry=&ViewMode=Automatic`,
  clusters: `/TradeClusters?Tickers={ticker}&StartDate={start}&EndDate={end}&${ANY_SIZE}&SecurityTypeKey=-1&TradeClusterRank=-1&SectorIndustry=&PresetSearchTemplateID=87&ViewMode=Automatic`,
  cluster_bombs: `/TradeClusterBombs?Tickers={ticker}&StartDate={start}&EndDate={end}&${ANY_SIZE}&TradeClusterBombRank=-1&SectorIndustry=&ViewMode=Automatic`,
  levels: `/TradeLevels?Ticker={ticker}&StartDate={start}&EndDate={end}&${ANY_SIZE}&TradeLevelRank=-1&TradeLevelCount=50&ViewMode=Automatic`,
  level_touches: `/TradeLevelTouches?Tickers={ticker}&StartDate={start}&EndDate={end}&${ANY_SIZE}&TradeLevelRank=10&PresetSearchTemplateID=87&ViewMode=Automatic`,
  chart: `/Chart0?Ticker={ticker}&StartDate={start}&EndDate={end}&${ANY_SIZE}&${ANY_PRINT}&VolumeProfile=0&Levels=5&TradeCount=3&TradeRank=-1&${ALL_SESSIONS}&ViewMode=Automatic`,
  institutional_volume:
    '/InstitutionalVolume?Date={start}&Tickers={ticker}&PresetSearchTemplateID=87&ViewMode=Automatic',
  ah_institutional_volume:
    '/AHInstitutionalVolume?Date={start}&Tickers={ticker}&PresetSearchTemplateID=87&ViewMode=Automatic',
  total_volume:
    '/TotalVolume?Date={start}&Tickers={ticker}&PresetSearchTemplateID=87&ViewMode=Automatic',
  exhaustion: '/ExhaustionScore',
};

function pageUrl(ticker, page) {
  const [today] = new Date().toISOString().split('T');
  const start = process.env.START_DATE ? process.env.START_DATE : today;
  const end = process.env.END_DATE ? process.env.END_DATE : today;
  const path = PAGES[page]
    .replace('{ticker}', encodeURIComponent(ticker))
    .replace('{start}', start)
    .replace('{end}', end);
  return new URL(path, ORIGIN).href;
}

const onLogin = (s) =>
  new URL(s.page.url()).pathname.toLowerCase().startsWith('/login');

async function signIn(s) {
  const email = statedText(['VL_EMAIL'], 'the VolumeLeaders login email');
  const password = statedText(
    ['VL_PASSWORD'],
    'the VolumeLeaders login password',
  );
  const submit = async () => {
    await s.goto(`${ORIGIN}/Login`);
    await pageSettled(s.page);
    await s.fillSelector('input[name="Email"]', email);
    await s.fillSelector('input[name="Password"]', password);
  };
  await submit();
  await s.page.locator('input[name="Password"]').press('Enter');
  await pageSettled(s.page);
  if (!onLogin(s)) return;
  await submit();
  console.error(`[vl] sign-in held; captcha: ${await s.solveCaptcha()}`);
  await s.page.locator('input[name="Password"]').press('Enter');
  await pageSettled(s.page);
  if (onLogin(s))
    throw new Error(
      `VL_SIGN_IN_FAILED: the sign-in stayed on ${s.page.url()} after its captcha`,
    );
}

await runMarketScrape({
  site: 'VolumeLeaders',
  code: 'VL',
  label: 'vl_scrape',
  catalog: PAGES,
  signIn,
  urlFor: (s, ticker, page) => pageUrl(ticker, page),
  rowPage: (page) => `vl_${page}`,
});
