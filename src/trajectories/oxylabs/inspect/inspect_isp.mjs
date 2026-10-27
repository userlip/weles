// READ-ONLY inspection of our actual Oxylabs account's Dedicated ISP plan.
// Answers "can we switch the burned Dedicated ISP IPs?" from the real
// account, not generic docs: reuses oxylabs/balance.mjs's exact Google-SSO
// login, then NAVIGATES (no mutating clicks) the dashboard pages the caller
// names and dumps text+HTML+screenshot of each once it has settled. Does NOT
// create, reset, subscribe, top up, or buy anything — strictly look-and-dump.
import { WSession } from '../../../../dist/session/wsession.js';
import {
  googleSso,
  getScopedGoogleLogin,
} from '../../_shared/services/google_sso.mjs';
import { humanClickLocator } from '../../../../dist/human/mouse.js';
import { pageSettled, urlMatching } from '../../_shared/page/settled.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';

const LOGIN_URL = 'https://dashboard.oxylabs.io/';
// The dumps belong to this run, kept with its recordings.
const OUT = runRecordingsDir('oxylabs_inspect_isp');
// Which dashboard pages are dumped is the caller's: OXYLABS_INSPECT_NAV lists
// the labels to follow, comma-separated, in order — nav items and the tabs
// on the pages they open alike. Clicking a label to VIEW a page is read-only.
const NAV = statedText(
  ['OXYLABS_INSPECT_NAV'],
  'the comma-separated dashboard labels (nav items and page tabs) whose pages are dumped, in order',
)
  .split(',')
  .map((label) => label.trim())
  .filter(Boolean);

const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login) throw new Error('no Google SSO creds for the Oxylabs dashboard');
console.log(`[inspect] Using Google SSO: ${login.email}`);

/** A label written as a file name: every run of other characters is one underscore. */
const fileName = (label) => label.replace(/[^a-z\d]+/gi, '_');

const s = await WSession.start({
  label: 'oxylabs_inspect_isp',
  browser: 'chromium',
});

/** Dump the settled page as `tag`: its text, its HTML and a full screenshot. */
async function dump(tag) {
  await pageSettled(s.page);
  const text = await s.page.evaluate(() => document.body.innerText); // allow-raw-playwright: read-only innerText, no DOM interaction
  writeFileSync(join(OUT, `${tag}.txt`), text);
  writeFileSync(join(OUT, `${tag}.html`), await s.page.content());
  await s.page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: true });
  console.log(
    `[inspect] dumped ${tag} (textlen=${text.length}, final=${s.page.url()})`,
  );
}

try {
  await s.goto(LOGIN_URL);
  await pageSettled(s.page);

  const gsiFrame = s.page.frames().find((f) => /gsi\/button/.test(f.url()));
  if (!gsiFrame) throw new Error('Oxylabs Google GSI iframe not found');
  const popupPromise = s.page.waitForEvent('popup');
  await humanClickLocator(
    s.page,
    gsiFrame.locator('div[role="button"]').first(),
  );
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  const ok = await googleSso(s, login, {
    originHost: 'oxylabs.io',
    page: popup,
  });
  if (!ok) throw new Error('Google SSO did not complete');

  await urlMatching(
    s.page,
    /^(?!https:\/\/dashboard\.oxylabs\.io\/en\/?(\?.*)?$)/,
  );
  console.log(`[inspect] post-login url=${s.page.url()}`);

  await dump('home');

  // A label the page does not show is named and the next is followed; the
  // run fails at the end naming every label it could not open, so a partial
  // dump never passes for a complete one.
  const unopened = [];
  for (const [position, label] of NAV.entries()) {
    const link = s.page.getByText(label, { exact: false }).first();
    if (!(await link.isVisible())) {
      console.log(`[inspect] "${label}" is not shown on ${s.page.url()}`);
      unopened.push(label);
      continue;
    }
    await humanClickLocator(s.page, link);
    await dump(`${position}_${fileName(label)}`);
  }
  if (unopened.length)
    throw new Error(
      `the dashboard showed no ${unopened.map((label) => `"${label}"`).join(', ')}; the other pages are dumped to ${OUT}/`,
    );
  console.log(
    `PASS: oxylabs ISP dashboard dumped to ${OUT}/ — inspect txt/html/png`,
  );
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close();
}
