// IPRoyal topup via Google SSO popup with consent click.
import { WSession } from '../../../dist/session/wsession.js';
import {
  googleSso,
  getGoogleSsoCreds,
} from '../_shared/services/google_sso.mjs';
import { topupOpts } from '../_shared/services/topup_common.mjs';
import { humanIdlePause } from '../../../dist/human/mouse.js';
import { pageSettled, urlMatching } from '../_shared/page/settled.mjs';
import { clickDescribed, clickOffered } from '../_shared/page/judged/seen.mjs';
import { runRecordingsDir } from '../../../dist/session/run-recordings.js';

const { usd } = topupOpts();
const login = await getGoogleSsoCreds();
if (!login) {
  console.log('FAIL: no Google SSO creds');
  process.exit(1);
}

const s = await WSession.start({ label: 'iproyal_topup', browser: 'chromium' });
try {
  await s.goto('https://dashboard.iproyal.com/login');
  await humanIdlePause('deliberate');
  const popupPromise = s.page.waitForEvent('popup').catch(() => null);
  await clickDescribed(s.page, 'the button to log in with Google');
  const popup = await popupPromise; // allow-raw-playwright: the popup the click produced
  if (!popup) throw new Error('popup did not open');
  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  const ok = await googleSso(s, login, {
    originHost: 'iproyal.com',
    page: popup,
  });
  if (!ok) throw new Error('Google SSO did not complete');

  await urlMatching(s.page, /^(?!.*\/login)/);

  // IPRoyal's actual topup flow: there is no /balance route
  // (dashboard.iproyal.com/balance answers 404 Page Not Found).
  // The real entry point is the "+ Add funds" button in the topbar of the
  // home dashboard, next to the $0.00 balance display.
  // A failed navigation stops the run: the pay controls are looked for on
  // whatever page is open.
  await s.page.goto('https://dashboard.iproyal.com/', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('deliberate');
  await clickDescribed(s.page, 'the button that adds funds to the balance');
  console.log('[trajectory] clicked the add-funds control');

  const amtIn = s.page
    .locator(
      'input[type="number"], input[name*="amount" i], input[inputmode="numeric"]',
    )
    .filter({ visible: true })
    .first();
  if (await amtIn.isVisible().catch(() => false)) {
    await amtIn.click();
    await amtIn.fill(String(usd));
    console.log(`[trajectory] amount filled: $${usd}`);
  }

  // The card payment method is a styled button, not a radio input; choosing
  // it surfaces the Stripe Elements card-number / expiry / cvc / postal frames.
  if (
    await clickOffered(s.page, 'the payment method for a credit or debit card')
  )
    console.log('[trajectory] selected the card payment method');
  else
    console.log(
      '[trajectory] no card payment method offered — proceeding with current selection',
    );

  // Probe: walk into each Stripe frame and list all inputs inside.
  try {
    await s.page
      .screenshot({
        path: `${runRecordingsDir('iproyal_topup')}/iproyal-deposit-state.png`,
        fullPage: true,
      })
      .catch(() => {});
    await humanIdlePause('deliberate');
    for (const f of s.page.frames()) {
      if (!/js\.stripe\.com|m\.stripe\.network/.test(f.url())) continue;
      try {
        const inputs = await f.evaluate(() =>
          Array.from(
            document.querySelectorAll('input, [contenteditable="true"]'),
          ).map(
            (i) =>
              `${i.tagName}:${i.type || ''}:name=${i.name || ''}:placeholder=${i.placeholder || ''}:autocomplete=${i.autocomplete || ''}`,
          ),
        );
        const url =
          f
            .url()
            .match(
              /elements-inner-([^-]+(?:-[^-]+)?)|m-outer|m\.stripe\.network/,
            )?.[0] || f.url();
        if (inputs.length)
          console.log(`[diag] frame=${url} inputs=${JSON.stringify(inputs)}`);
      } catch {}
    }
  } catch (e) {
    console.log('[diag] err:', e.message);
  }

  // Fill the Stripe Elements card form with TOPUP_CARD_* env values
  // (issued by the orchestrator from a Privacy.com / Stripe-Issuing card
  // vault). Without these env vars the trajectory cannot fill the form
  // and exits early with a clear blocker reason.
  const { fillStripeElements } = await import(
    '../_shared/services/topup_common.mjs'
  );
  const fill = await fillStripeElements(s.page);
  console.log(`[trajectory] stripe elements fill: ${JSON.stringify(fill)}`);
  if (!fill.ok)
    throw new Error(
      `stripe elements not fully filled: ${JSON.stringify(fill)}`,
    );

  // Watch for Stripe payment_intents POST to confirm the charge actually fires.
  let stripeChargeFired = false;
  s.ctx.on('request', (req) => {
    if (
      /api\.stripe\.com\/v1\/(payment_intents|setup_intents).*confirm/.test(
        req.url(),
      )
    )
      stripeChargeFired = true;
  });

  console.log('[trajectory] clicking the deposit button');
  await clickDescribed(s.page, 'the button that pays the deposit');
  await pageSettled(s.page);
  await s.page
    .screenshot({
      path: `${runRecordingsDir('iproyal_topup')}/iproyal-after-deposit.png`,
      fullPage: true,
    })
    .catch(() => {});
  // Probe for validation errors / captcha after the deposit click.
  try {
    const post = await s.page.evaluate(() => {
      const errs = Array.from(
        document.querySelectorAll(
          '[class*="error" i], [role="alert"], [aria-invalid="true"], .invalid',
        ),
      )
        .filter((e) => e.offsetParent)
        .map((e) => (e.textContent || '').trim());
      const captcha = Array.from(document.querySelectorAll('iframe'))
        .filter((i) => /captcha/i.test(i.src) && i.offsetParent)
        .map((i) => i.src);
      return { errs, captcha };
    });
    console.log('[diag] post-deposit:', JSON.stringify(post));
  } catch {}
  if (!stripeChargeFired)
    throw new Error(
      `Deposit clicked but no Stripe charge POST observed by the time the page settled, url=${s.page.url()}`,
    );
  console.log(
    `PASS-CHARGED: Stripe payment_intents/confirm POST fired, url=${s.page.url()}`,
  );
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await s.close();
}
