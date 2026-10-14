// Pingproxies (Byteful) topup via Google SSO.
import { WSession } from '../../../dist/session/wsession.js';
import {
  googleSso,
  getGoogleSsoCreds,
} from '../_shared/services/google_sso.mjs';
import {
  loadTopupCardEnv,
  topupOpts,
} from '../_shared/services/topup_common.mjs';
import { humanIdlePause } from '../../../dist/human/mouse.js';
import { pageSettled } from '../_shared/page/settled.mjs';
import { confirmedFill } from '../_shared/page/confirmed-fill.mjs';
import { exitStatusFor } from '../../../dist/cli/usage.js';

const { usd } = topupOpts();
let s;
try {
  loadTopupCardEnv();
  const cardDigits = process.env.TOPUP_CARD_NUMBER?.replace(/\D/g, '');
  const cardMatch = cardDigits?.match(/(\d\d\d\d)$/);
  const cardLast4 = cardMatch?.pop();
  const login = await getGoogleSsoCreds();
  if (!login) throw new Error('no Google SSO credentials; nothing was charged');
  // The charge goes on the purchase card the caller supplied, picked among
  // saved cards by the last four digits a saved card shows.
  if (!cardLast4)
    throw new Error(
      'TOPUP_CARD_NUMBER is not set (from TOPUP_CARD_JSON or a topup_card.env): the saved card this top-up charges is picked by its last four digits; nothing was charged',
    );
  const precision = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).resolvedOptions().maximumFractionDigits;
  const statedDollars = usd.toFixed(precision);
  if (Number(statedDollars) !== usd)
    throw new Error(
      `TOPUP_USD=${usd} cannot be charged as whole USD cents; nothing was charged`,
    );
  const expectedMinorUnits = Number(statedDollars.replace('.', ''));
  if (!Number.isSafeInteger(expectedMinorUnits))
    throw new Error(
      `TOPUP_USD=${usd} exceeds an exact USD-cent amount; nothing was charged`,
    );
  s = await WSession.start({ label: 'pingproxies_topup', browser: 'chromium' });
  await s.goto('https://dashboard.byteful.com/login');
  await humanIdlePause('deliberate');
  await s.page
    .locator(
      'button:has-text("Continue with Google"), button:has-text("Sign in with Google")',
    )
    .filter({ visible: true })
    .first()
    .click();
  const ok = await googleSso(s, login, { originHost: 'byteful.com' });
  if (!ok) throw new Error('Google SSO did not complete');

  await humanIdlePause('long');
  // The home dashboard Add-balance modal exposes "Show More Payment
  // Options" that may reveal the saved cards on file. The wallet variant of
  // the modal (entered from /billing/wallet) does NOT show them — only New
  // Card + Crypto. Going via home to reach the saved-card option.
  // A failed navigation stops the run: the balance controls are looked for
  // on whatever page is open.
  await s.page.goto('https://dashboard.byteful.com/', {
    waitUntil: 'domcontentloaded',
  });
  await humanIdlePause('deliberate');
  const addBalanceBtns = s.page
    .locator('button:has-text("Add balance"), a:has-text("Add balance")')
    .filter({ visible: true });
  const count = await addBalanceBtns.count();
  console.log(
    `[trajectory] found ${count} "Add balance" buttons; opening the wallet control`,
  );
  const addBalanceBtn = addBalanceBtns.last();
  if (!(await addBalanceBtn.isVisible()))
    throw new Error('"Add balance" button not visible');
  await addBalanceBtn.click();
  await pageSettled(s.page);
  const [dialog, ...otherDialogs] = await s.page
    .locator('[role="dialog"]')
    .filter({ visible: true })
    .all();
  if (!dialog)
    throw new Error('Add balance opened no visible dialog; nothing was charged');
  if (otherDialogs.length)
    throw new Error(
      'Add balance opened multiple visible dialogs; payment controls are ambiguous',
    );

  // The modal opens with its own default amount; a charge is only ever made
  // for the amount asked for, so the field must be there and must read back
  // exactly that amount before anything is confirmed.
  const amountInputs = await dialog
    .locator(
      'input[type="number"], input[name*="amount" i], input[inputmode="numeric"]',
    )
    .filter({ visible: true })
    .all();
  const [amtIn, ...otherAmounts] = amountInputs;
  if (!amtIn)
    throw new Error(
      `the Add balance modal shows no amount field; $${usd} could not be entered and nothing was charged`,
    );
  if (otherAmounts.length)
    throw new Error(
      `the Add balance modal shows multiple amount candidates; $${usd} cannot be entered unambiguously`,
    );
  await confirmedFill(s.page, amtIn, String(usd), 'the top-up amount field');

  // Click "Show More Payment Options" then the saved card option
  // (/billing/payment-methods holds the saved default card). The
  // home-dashboard Add balance modal exposes this via the "Show More
  // Payment Options" expander. Without explicitly selecting a saved card,
  // the modal's "Add store credit" click is silently aborted by byteful's
  // React onClick.
  const showMore = dialog
    .locator(
      'button:has-text("Show More Payment Options"), a:has-text("Show More Payment Options")',
    )
    .filter({ visible: true })
    .first();
  if (await showMore.isVisible()) {
    await showMore.click();
    console.log('[trajectory] clicked "Show More Payment Options"');
    await humanIdlePause('deliberate');
  }


  const ccTab = dialog
    .locator(
      '[role="tab"]:has-text("Credit card"), button:has-text("Credit card"), label:has-text("Credit card")',
    )
    .filter({ visible: true })
    .first();
  if (await ccTab.isVisible()) {
    await ccTab.click({ force: true });
    console.log('[trajectory] clicked Credit card tab');
    await humanIdlePause('short');
  }

  const agreeBtn = dialog
    .locator('button:has-text("Agree & Continue")')
    .filter({ visible: true })
    .first();
  if (await agreeBtn.isVisible()) {
    await agreeBtn.click({ force: true });
    console.log('[trajectory] clicked "Agree & Continue"');
    await humanIdlePause('deliberate');
  }
  const matchingCards = await dialog
    .locator(
      `label:has-text("${cardLast4}"), [role="radio"]:has-text("${cardLast4}")`,
    )
    .filter({ visible: true })
    .all();
  const [savedCard, ...otherCards] = matchingCards;
  if (!savedCard)
    throw new Error(
      `no saved card ending ${cardLast4} is offered in the Add balance modal; the default selection is not charged`,
    );
  if (otherCards.length)
    throw new Error(
      `multiple saved card controls end ${cardLast4}; the purchase card cannot be chosen uniquely`,
    );
  const radio = savedCard.locator('input[type="radio"]').first();
  let cardSelected;
  if (await radio.count()) {
    await radio.check({ force: true });
    cardSelected = () => radio.isChecked();
  } else if ((await savedCard.getAttribute('role')) === 'radio') {
    await savedCard.click();
    cardSelected = async () =>
      (await savedCard.getAttribute('aria-checked')) === 'true';
  } else {
    throw new Error(
      `saved card ending ${cardLast4} offers no checkable radio; no default card is charged`,
    );
  }
  if (!(await cardSelected()))
    throw new Error(
      `saved card ending ${cardLast4} did not remain selected; nothing was charged`,
    );
  console.log(`[trajectory] selected saved card ending ${cardLast4}`);


  const confirmBtn = dialog
    .locator('button:has-text("Add store credit")')
    .filter({ visible: true })
    .first();
  if (!(await confirmBtn.isVisible()))
    throw new Error('"Add store credit" button not visible inside modal');
  if (!(await confirmBtn.isEnabled()))
    throw new Error('"Add store credit" is disabled; nothing was charged');
  const heldAmount = await amtIn.inputValue();
  if (heldAmount !== String(usd))
    throw new Error(
      `the Add balance modal holds ${heldAmount}, not the requested $${usd}; nothing was charged`,
    );
  if (!(await cardSelected()))
    throw new Error(
      `saved card ending ${cardLast4} is no longer selected; nothing was charged`,
    );
  const chargeRequests = [];
  let setupRequest;
  const onRequest = (request) => {
    if (request.method() !== 'POST') return;
    const url = new URL(request.url());
    if (url.hostname !== 'api.stripe.com') return;
    if (/^\/v1\/payment_intents\/[^/]+\/confirm$/.test(url.pathname))
      chargeRequests.push(request);
    if (/^\/v1\/setup_intents\/[^/]+\/confirm$/.test(url.pathname))
      setupRequest = request;
  };
  s.page.on('request', onRequest);
  try {
    await confirmBtn.focus();
    await s.page.keyboard.press('Enter');
    console.log('[trajectory] focused + pressed Enter on Add store credit');
    await pageSettled(s.page);
  } finally {
    s.page.off('request', onRequest);
  }
  const [chargeRequest, ...otherCharges] = chargeRequests;
  if (otherCharges.length)
    throw new Error(
      `multiple Stripe payment confirmations were observed; reconcile the account before another payment`,
    );
  if (!chargeRequest)
    throw new Error(
      `deposit-confirm dispatched but ${setupRequest ? 'only a setup intent' : 'no Stripe confirmation request'} was observed; payment outcome is unconfirmed at ${s.page.url()}`,
    );
  const response = await chargeRequest.response();
  if (!response)
    throw new Error(
      `Stripe confirmation request has no response; request.failure=${JSON.stringify(chargeRequest.failure())}; payment outcome is unconfirmed`,
    );
  const finished = await response.finished();
  if (finished)
    throw new Error(
      `Stripe confirmation response failed: ${finished.message}; payment outcome is unconfirmed`,
      { cause: finished },
    );
  let intent;
  try {
    intent = await response.json();
  } catch (error) {
    throw new Error(
      `Stripe confirmation response could not be read: ${error.message}; payment outcome is unconfirmed`,
      { cause: error },
    );
  }
  if (!response.ok())
    throw new Error(
      `Stripe refused confirmation with HTTP ${response.status()}: code=${intent?.error?.code}, message=${intent?.error?.message}; payment was not confirmed`,
    );
  if (
    intent?.status !== 'succeeded' ||
    typeof intent.id !== 'string' ||
    !intent.id ||
    intent.currency !== 'usd' ||
    intent.amount_received !== expectedMinorUnits
  )
    throw new Error(
      `Stripe confirmation did not prove the requested charge: id=${intent?.id}, status=${intent?.status}, currency=${intent?.currency}, received=${intent?.amount_received}, requested=${expectedMinorUnits}; reconcile before another payment`,
    );
  console.log(
    `PASS-CHARGED: Stripe payment intent ${intent.id} succeeded for $${usd}; provider wallet credit remains to be checked`,
  );
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = exitStatusFor(e);
} finally {
  if (s) await s.close();
}
