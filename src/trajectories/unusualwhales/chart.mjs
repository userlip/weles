// Capture one chart of a symbol's Unusual Whales flow overview: the tab the
// run states (CHART_TAB, as the page labels it) is clicked (found by the
// vision model), and the page's largest drawn chart (svg or canvas, by drawn
// area) is kept as a screenshot in the run's recordings, then persisted
// through the Trading Tools ingest. TICKER, CHART_TAB, UW_EMAIL and
// UW_PASSWORD are required; PROXY_URL states the proxy ('direct' for none).
import { join } from 'node:path';
import { WSession } from '../../../dist/session/wsession.js';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../dist/cli/usage.js';
import { statedProxy, statedText } from '../_shared/inputs/stated.mjs';
import { clickDescribed } from '../_shared/page/judged/seen.mjs';
import { pageSettled } from '../_shared/page/settled.mjs';
import { loginUnusualWhales } from './session/login.mjs';
import { persistContext } from '../_shared/market/persist.mjs';

const ticker = statedText(['TICKER'], 'the symbol whose flow overview chart is captured').toUpperCase();
const tab = statedText(['CHART_TAB'], 'the flow overview tab whose chart is captured, as the page labels it');
const email = statedText(['UW_EMAIL'], 'the Unusual Whales login email');
const password = statedText(['UW_PASSWORD'], 'the Unusual Whales login password');

const s = await WSession.start({ label: `uw_chart_${ticker}`, proxy: statedProxy('the Unusual Whales chart capture') });
try {
  await loginUnusualWhales(s, email, password);
  const url = `https://unusualwhales.com/stock/${encodeURIComponent(ticker)}/flow-overview`;
  await s.goto(url);
  await pageSettled(s.page);
  await clickDescribed(s.page, `the tab labelled "${tab}" above the flow overview chart`);
  await pageSettled(s.page);
  const chart = await s.page.evaluateHandle(() => {
    const area = (node) => node.getBoundingClientRect().width * node.getBoundingClientRect().height;
    const [largest] = Array.from(document.querySelectorAll('svg, canvas')).sort((a, b) => area(b) - area(a));
    return largest && area(largest) ? largest.parentElement : null;
  });
  const element = chart.asElement();
  if (!element) throw new Error(`UW_CHART_MISSING: the "${tab}" tab of ${url} draws no svg or canvas chart`);
  const screenshotPath = join(runRecordingsDir('uw_chart'), `${ticker}_${tab.replace(/\W+/g, '_')}.png`);
  await element.screenshot({ path: screenshotPath });
  const persisted = await persistContext({
    ticker,
    page: 'chart',
    tab,
    data: { url },
    screenshotPath,
    metadata: { source: 'uw_chart' },
  });
  console.log(`PASS: chart "${tab}" for ${ticker} kept at ${screenshotPath}, persisted ${persisted.id}`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = exitStatusFor(error);
} finally {
  await s.close();
}
