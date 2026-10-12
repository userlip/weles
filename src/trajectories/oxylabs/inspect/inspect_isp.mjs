// READ-ONLY inspection of our actual Oxylabs account's Dedicated ISP plan.
// Answers "can we switch the burned Dedicated ISP IPs?" from the real
// account, not generic docs: reuses oxylabs/balance.mjs's exact Google-SSO
// login, then NAVIGATES (no mutating clicks) the proxy/ISP management
// pages and dumps text+HTML+screenshot for inspection. Does NOT create,
// reset, subscribe, top up, or buy anything — strictly look-and-dump.
import { WSession } from '../../../../dist/session/wsession.js';
import {
  googleSso,
  getScopedGoogleLogin,
} from '../../_shared/services/google_sso.mjs';
import {
  humanIdlePause,
  humanClickLocator,
} from '../../../../dist/human/mouse.js';
import { urlMatching } from '../../_shared/page/settled.mjs';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { statedText } from '../../_shared/inputs/stated.mjs';
import { runRecordingsDir } from '../../../../dist/session/run-recordings.js';
import { exitStatusFor } from '../../../../dist/cli/usage.js';

const LOGIN_URL = 'https://dashboard.oxylabs.io/';
// The dumps belong to this run, kept with its recordings.
const OUT = runRecordingsDir('oxylabs_inspect_isp');
// Navigate via the REAL left-nav items (guessed URLs 404'd last run).
// Clicking a nav link to VIEW a page is read-only — no mutation. Which
// dashboard pages are dumped is the caller's: OXYLABS_INSPECT_NAV lists the
// nav labels, comma-separated.
const NAV = statedText(
  ['OXYLABS_INSPECT_NAV'],
  'the comma-separated dashboard nav labels whose pages are dumped',
)
  .split(',')
  .map((label) => label.trim())
  .filter(Boolean);

const login = await getScopedGoogleLogin('oxylabsDashboard');
if (!login) throw new Error('no Google SSO creds for the Oxylabs dashboard');
console.log(`[inspect] Using Google SSO: ${login.email}`);

const s = await WSession.start({
  label: 'oxylabs_inspect_isp',
  browser: 'chromium',
});
try {
  await s.goto(LOGIN_URL);
  await humanIdlePause('long');

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

  async function dump(tag) {
    await humanIdlePause('long');
    const text = await s.page.evaluate(() => document.body.innerText); // allow-raw-playwright: read-only innerText, no DOM interaction
    writeFileSync(join(OUT, `${tag}.txt`), text);
    writeFileSync(join(OUT, `${tag}.html`), await s.page.content());
    await s.page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: true });
    console.log(
      `[inspect] dumped ${tag} (textlen=${text.length}, final=${s.page.url()})`,
    );
  }

  await dump('00_home');

  // The nav labels were stated before sign-in (OXYLABS_INSPECT_NAV).
  for (const [i, label] of NAV.entries()) {
    try {
      const link = s.page.getByText(label, { exact: false }).first();
      if (!(await link.isVisible().catch(() => false))) {
        console.log(`[inspect] nav "${label}" not visible`);
        continue;
      }
      await humanClickLocator(s.page, link);
      await humanIdlePause('deliberate');
      const tag = `${String(i + 1).padStart(2, '0')}_${label.replace(/[^a-z0-9]+/gi, '_')}`;
      await dump(tag);
      // On the product page, surface any IP-management / replace / setup tab.
      for (const sub of [
        /IP list/i,
        /IP management/i,
        /Replace/i,
        /Whitelist/i,
        /Endpoint/i,
        /Setup/i,
        /Locations?/i,
      ]) {
        const t = s.page.getByText(sub).first();
        if (await t.isVisible().catch(() => false)) {
          await humanClickLocator(s.page, t);
          await humanIdlePause('deliberate');
          await dump(
            `${tag}__${sub.source.replace(/[^a-z0-9]+/gi, '_').slice(0, 20)}`,
          );
          break;
        }
      }
    } catch (e) {
      console.log(`[inspect] nav "${label}" err: ${e.message || String(e)}`);
    }
  }
  console.log(
    `PASS: oxylabs ISP dashboard dumped to ${OUT}/ — inspect txt/html/png`,
  );
} catch (e) {
  console.log('FAIL:', e.message || String(e));
  process.exitCode = exitStatusFor(e);
} finally {
  await s.close();
}
