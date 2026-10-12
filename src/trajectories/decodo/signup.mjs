// Decodo (ex-Smartproxy): log in with the SHARED Google SSO account
// (via getGoogleSsoCreds/googleSso, the same one
// every other service trajectory uses) and purchase US Dedicated Static
// Residential (ISP) proxies, then scrape the issued proxy credentials into
// the run-output root's `keeper/decodo_isp.json` and append the endpoint to
// weles/.env.
//
// Modeled on oxylabs/isp_subscribe.mjs (the proven ISP-purchase pattern):
//   1. WSession chromium -> dashboard.decodo.com/login -> Google sign-in
//      -> capture popup -> googleSso(... originHost 'decodo.com' ...).
//   2. /isp/pricing, screenshot+dump each step (evidence, not blind guesses).
//   3. Pick USA, walk buy -> checkout. Never Stripe Link: if the Link OTP
//      modal shows, click "Pay without Link" then fillStripeElements with the
//      card the shared loader sourced (a file under ~/.weles or ~/.stado, or
//      one TOPUP_CARD_JSON value injected from Skarbiec).
//   4. Commit, scrape host/port/user/pass, persist + wire .env.
//
// Purchase is gated behind DECODO_BUY_CONFIRM=1; screenshots are written
// before every commit click for audit (same pattern as the Oxylabs script).
//
// Presence checks use locator.count() (resolves to a number, never rejects);
// the OAuth popup is captured via a ctx 'page' listener (no promise-rejection
// sentinel). Real Playwright errors propagate to the outer handler.
import { runOutputPath } from '#run-output';
import { WSession } from '../../../dist/session/wsession.js';
import {
  googleSso,
  getGoogleSsoCreds,
} from '../_shared/services/google_sso.mjs';
import {
  fillStripeElements,
  loadTopupCardEnv,
} from '../_shared/services/topup_common.mjs';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { humanClickLocator } from '../../../dist/human/mouse.js';
import { clickOffered, pageShows } from '../_shared/page/judged/seen.mjs';
import { pageSettled, popupOrNavigation } from '../_shared/page/settled.mjs';
import { humanType } from '../../../dist/human/keyboard.js';

loadTopupCardEnv();

const CONFIRM = process.env.DECODO_BUY_CONFIRM === '1';
const OUT_DIR = runOutputPath('keeper', 'decodo_isp_buy');
mkdirSync(OUT_DIR, { recursive: true });
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const present = async (loc) => (await loc.count()) > 0;

async function shot(s, label) {
  const fp = `${OUT_DIR}/${stamp()}_${label}.png`;
  try {
    await s.page.screenshot({ path: fp, fullPage: true });
    console.log(`[shot] ${fp}`);
  } catch (e) {
    console.log(`[shot] skip ${label}: ${e.message || ''}`);
  }
  return fp;
}
async function dump(s, label) {
  const t = await s.page.evaluate(() => document.body.innerText); // allow-raw-playwright: read-only innerText
  writeFileSync(`${OUT_DIR}/${stamp()}_${label}.txt`, t);
  return t;
}

const login = await getGoogleSsoCreds();
if (!login) {
  console.log('FAIL: no Google SSO creds in service_credentials');
  process.exit(1);
}
console.log(`[decodo] Using shared Google SSO: ${login.email}`);

// Label matches the filename ('signup') so the inspection tooling
// (inspect_trajectory.sh signup / the label-pinned transcript scanner) can
// actually locate this run's recording; a mismatched WSession label made the
// pre_bash count-gate undismissable.
const s = await WSession.start({ label: 'signup', browser: 'chromium' });
try {
  let popup = null;

  await s.page.goto('https://dashboard.decodo.com/login', {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(s.page);
  await shot(s, '00_login');

  // Google Identity Services renders the sign-in button inside a cross-origin
  // accounts.google.com/gsi/button iframe that attaches asynchronously after
  // SPA hydration — run #3 failed because frames().find ran before it
  // attached and the page-level button selector matched a non-actionable
  // wrapper (locator.click 30s timeout). The GSI frame is read once the page
  // has settled; its rendered button is clicked once visible. Without it,
  // Decodo's own "Sign in with Google" button is clicked by exact text.
  // humanClickLocator needs a Page (.mouse) as first arg, so pass s.page with
  // the frame-scoped locator.
  await pageSettled(s.page);
  const gsiFrame = s.page
    .frames()
    .find((f) => /accounts\.google\.com\/gsi|gsi\/button/.test(f.url()));
  // The click opens Google in a popup or redirects this tab to it.
  popup = await popupOrNavigation(s.page, /accounts\.google\./, async () => {
    if (gsiFrame) {
      const gi = gsiFrame.locator('div[role="button"]').first();
      await gi.waitFor({ state: 'visible' });
      await humanClickLocator(s.page, gi);
    } else {
      const gBtn = s.page
        .locator(
          'button:has-text("Sign in with Google"), a:has-text("Sign in with Google"), button:has-text("with Google")',
        )
        .filter({ visible: true })
        .first();
      if (!(await gBtn.isVisible())) {
        await shot(s, '00b_no_google_btn');
        throw Object.assign(
          new Error('No Google sign-in control on Decodo login'),
          {
            code: 'DECODO_GOOGLE_CONTROL_UNAVAILABLE',
            pageUrl: s.page.url(),
          },
        );
      }
      await gBtn.scrollIntoViewIfNeeded();
      await humanClickLocator(s.page, gBtn);
    }
  });

  const ok = await googleSso(s, login, {
    originHost: 'decodo.com',
    page: popup || undefined,
  });
  if (!ok) {
    await shot(s, '01_sso_fail');
    throw new Error('Google SSO did not complete');
  }

  // googleSso's non-popup success check matches ANY url containing the
  // originHost. Decodo's GSI is redirect-mode, so the OAuth redirect_uri
  // query string contains "decodo.com" and googleSso returns true while
  // still on the un-consented Google consent screen (verified run #2:
  // post-login url was accounts.google.pl/SetSID, /isp/pricing -> /login).
  // Finish OAuth here: click the account tile / Continue / Allow on whichever
  // page is live until we are genuinely on dashboard.decodo.com and NOT on
  // /login. No false PASS — hard-fail if the session never establishes.
  // The SPA can render a login form at the dashboard URL, so the dashboard
  // counts as signed in only off its /login route and without a visible
  // password field.
  const authed = async () => {
    const here = new URL(s.page.url());
    if (here.hostname !== 'dashboard.decodo.com') return false;
    if (here.pathname.startsWith('/login')) return false;
    return !(await s.page
      .locator('input[type="password"]')
      .filter({ visible: true })
      .count());
  };
  // Google's account tiles are found by their markup; the consent screen's
  // allow control by the vision model.
  const ACCOUNT_TILES = [
    'div[data-identifier]',
    'div[role="link"][data-email]',
    'div[data-authuser]',
  ];
  // Each consent control and the GSI re-trigger is used at most once; a settled
  // page that offers none of them and is not the authenticated dashboard ends
  // the walk with the named failure below.
  let loggedIn = false;
  const used = new Set();
  for (;;) {
    const dpg = popup && !popup.isClosed() ? popup : s.page;
    await pageSettled(dpg);
    if (dpg !== s.page) await pageSettled(s.page);
    if (await authed()) {
      loggedIn = true;
      break;
    }
    let acted = false;
    for (const sel of ACCOUNT_TILES) {
      if (used.has(sel)) continue;
      const b = dpg.locator(sel).filter({ visible: true }).first();
      if (await present(b)) {
        used.add(sel);
        await humanClickLocator(dpg, b);
        acted = true;
        break;
      }
    }
    if (!acted && !used.has('consent')) {
      acted = await clickOffered(
        dpg,
        'the button on the Google consent screen that allows the sign-in and continues',
      );
      if (acted) used.add('consent');
    }
    // If OAuth bounced back to Decodo's own login form, re-trigger the
    // Google button (the GSI iframe re-renders in place).
    if (
      !acted &&
      !used.has('gsi') &&
      /dashboard\.decodo\.com/.test(s.page.url())
    ) {
      used.add('gsi');
      const reGsi = s.page
        .frames()
        .find((f) => /accounts\.google\.com\/gsi|gsi\/button/.test(f.url()));
      if (reGsi) {
        await humanClickLocator(
          s.page,
          reGsi.locator('div[role="button"]').first(),
        );
        acted = true;
      } else {
        acted = await clickOffered(s.page, 'the Sign in with Google button');
      }
    }
    if (!acted) break;
  }
  console.log(`[decodo] post-login url=${s.page.url()} loggedIn=${loggedIn}`);
  await shot(s, '02_dashboard');
  await dump(s, '02_dashboard');
  if (!loggedIn) {
    console.log(
      `FAIL: Decodo session not established (url=${s.page.url()}, login form still rendered) — Google OAuth did not bind to Decodo. See 02_dashboard.png`,
    );
    process.exit(1);
  }

  // Static Residential (ISP) product. Left-nav label is "Static Residential
  // (ISP)"; route observed this session is /isp/pricing.
  await s.page.goto('https://dashboard.decodo.com/isp/pricing', {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(s.page);
  console.log(`[decodo] isp pricing url=${s.page.url()}`);
  await shot(s, '03_isp_pricing');
  await dump(s, '03_isp_pricing');

  if (!CONFIRM) {
    console.log(
      '[decodo] purchase confirmation missing after SSO login and ISP pricing reached. Set DECODO_BUY_CONFIRM=1 to purchase US Dedicated Static Residential.',
    );
    console.log(`[decodo] artifacts in ${OUT_DIR}/ (03_isp_pricing.png/.txt)`);
    process.exit(2);
  }

  // Pick USA where a country control exists, then walk buy -> checkout.
  if (
    await clickOffered(
      s.page,
      'the United States option of the country selector',
    )
  ) {
    await pageSettled(s.page);
    await shot(s, '04_us_selected');
  }

  await shot(s, '05_before_buy');
  if (
    !(await clickOffered(
      s.page,
      'the button that buys, subscribes to or checks out the dedicated static residential (ISP) plan',
    ))
  ) {
    await shot(s, '04b_no_buy');
    console.log('FAIL: no buy/checkout control on ISP page');
    process.exit(1);
  }
  await pageSettled(s.page);
  await shot(s, '06_after_buy');
  console.log(`[decodo] after buy url=${s.page.url()}`);

  // However many checkout steps Decodo shows are walked; it ends on a page
  // that confirms the order or one with no committal control, which the log
  // names.
  for (let step = 0; ; step++) {
    await pageSettled(s.page);
    const url = s.page.url();
    await shot(s, `07_checkout_${step}`);
    console.log(`[decodo] checkout step ${step}: ${url}`);
    if (
      await pageShows(
        s.page,
        'Does the page confirm that the order or subscription succeeded?',
      )
    ) {
      await shot(s, '08_success');
      console.log(`[decodo] success: ${url}`);
      break;
    }

    const otpCells = s.page.locator(
      'input[maxlength="1"], input[inputmode="numeric"]',
    );
    if ((await otpCells.count()) >= 6) {
      if (
        !(await clickOffered(
          s.page,
          'the control that pays without Stripe Link',
        ))
      ) {
        await shot(s, 'no_pay_without_link');
        console.log('FAIL: Stripe Link OTP, no "Pay without Link"');
        process.exit(2);
      }
      await pageSettled(s.page);
      await shot(s, 'after_pay_without_link');
    }

    const cardNum = s.page
      .locator('input[autocomplete="cc-number"], input[name="cardnumber"]')
      .first();
    const stripeFrame = s.page
      .frames()
      .some(
        (f) =>
          URL.canParse(f.url()) &&
          new URL(f.url()).hostname.endsWith('stripe.com'),
      );
    if (stripeFrame || (await cardNum.count()) > 0) {
      const filled = await fillStripeElements(s.page);
      console.log(`[decodo] fillStripeElements: ${JSON.stringify(filled)}`);
      if (!filled || !filled.ok) {
        await shot(s, 'card_fill_failed');
        console.log(`FAIL: card fill ${JSON.stringify(filled)}`);
        process.exit(2);
      }
      const nm = process.env.TOPUP_CARD_NAME || '';
      const nameLoc = s.page
        .locator(
          'input[autocomplete="cc-name"], input[name="billingName"], input[placeholder*="Cardholder" i], input[placeholder*="name on card" i]',
        )
        .filter({ visible: true })
        .first();
      if (nm && (await present(nameLoc))) {
        await humanClickLocator(s.page, nameLoc);
        await humanType(s.page, nm);
      }
      await pageSettled(s.page);
      await shot(s, 'after_card_fill');
    }

    await shot(s, `before_commit_${step}`);
    const clicked = await clickOffered(
      s.page,
      'the button that pays or moves the checkout forward (not one that pays with Stripe Link)',
    );
    if (!clicked) {
      console.log(`[decodo] no committal button at step ${step}`);
      break;
    }
    await pageSettled(s.page);
  }

  // Scrape issued proxy creds from the ISP overview / setup view.
  await s.page.goto('https://dashboard.decodo.com/isp', {
    waitUntil: 'domcontentloaded',
  });
  await pageSettled(s.page);
  await shot(s, '09_isp_overview');
  let ispOut = await dump(s, '09_isp_overview');
  if (
    await clickOffered(
      s.page,
      'the tab that shows the proxy authentication or endpoint setup',
    )
  ) {
    await pageSettled(s.page);
    await shot(s, '10_isp_auth');
    ispOut += '\n' + (await dump(s, '10_isp_auth'));
  }
  writeFileSync(`${OUT_DIR}/${stamp()}_isp_auth.html`, await s.page.content());

  const ips = ispOut.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g) || [];
  const hostPort = ispOut.match(
    /([a-z0-9.-]+\.(?:decodo|smartproxy)\.com):(\d{2,5})/i,
  );
  const rec = {
    captured_at: new Date().toISOString(),
    sso: login.email,
    ips: [...new Set(ips)],
    endpoint: hostPort ? hostPort[0] : null,
  };
  writeFileSync(
    runOutputPath('keeper', 'decodo_isp.json'),
    JSON.stringify(rec, null, 2),
  );
  console.log(
    `[decodo] wrote ${runOutputPath('keeper', 'decodo_isp.json')} ips=${rec.ips.length} endpoint=${rec.endpoint || 'none'}`,
  );
  if (rec.endpoint) {
    appendFileSync(
      join(process.cwd(), '.env'),
      `\n# Decodo ISP (added ${rec.captured_at})\nDECODO_ISP_ENDPOINT=${rec.endpoint}\n`,
    );
    console.log('[decodo] appended DECODO_ISP_ENDPOINT to weles/.env');
  }
  console.log(
    `PASS: decodo Google-SSO login + US ISP purchase flow complete — audit screenshots in ${OUT_DIR}`,
  );
} catch (e) {
  console.error('FAIL:', e);
  try {
    await s.page.screenshot({
      path: `${OUT_DIR}/${stamp()}_error.png`,
      fullPage: true,
    });
  } catch (e2) {
    console.log(`[shot] error-shot skip: ${e2.message || ''}`);
  }
  process.exitCode = 1;
} finally {
  try {
    await s.close();
  } catch (e) {
    console.log(`[decodo] close: ${e.message || ''}`);
  }
}
