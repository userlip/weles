// Shared scaffolding for service-credential topup trajectories.
// TOPUP_CONFIRM=1 is required before any provider topup flow can continue.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pageSettled } from '../page/settled.mjs';
import { clickOffered } from '../page/judged/seen.mjs';
import { humanType } from '../../../../dist/human/keyboard.js';

// The amount charged is the caller's: no amount is assumed.
export function topupOpts() {
  const usd = Number(process.env.TOPUP_USD);
  if (
    !process.env.TOPUP_USD ||
    !(usd >= Number.MIN_VALUE) ||
    !Number.isFinite(usd)
  ) {
    console.log(
      `FAIL: TOPUP_USD is ${process.env.TOPUP_USD ? `"${process.env.TOPUP_USD}", not an amount above zero` : 'not set'}: the US dollars this top-up charges; nothing is assumed`,
    );
    process.exit(1);
  }
  if (process.env.TOPUP_CONFIRM !== '1') {
    console.log('FAIL: TOPUP_CONFIRM=1 required before charging');
    process.exit(2);
  }
  return { usd };
}

// The provider's pay button, found by the vision model in whatever words the
// checkout uses; false when the page offers none.
export async function findAndClickPayButton(page) {
  const clicked = await clickOffered(
    page,
    'the button that pays or checks out the top-up amount',
  );
  if (clicked) console.log('[topup] clicked the pay button');
  return clicked;
}

// Stripe Elements card-form filler. Each input lives in a cross-origin iframe;
// frame URL contains the field type (card-number / card-expiry /
// card-cvc / postal-code).
const STRIPE_FRAME_PATTERNS = {
  cardNumber:
    /elements-inner-(card-?number|cardNumber|payment-card-?number|payment[^/]*card-?number)/i,
  cardExpiry:
    /elements-inner-(card-?expiry|cardExpiry|payment-card-?expiry|payment[^/]*card-?expiry)/i,
  cardCvc:
    /elements-inner-(card-?cvc|cardCvc|payment-card-?cvc|payment[^/]*card-?cvc)/i,
  postalCode:
    /elements-inner-(postal-?code|postalCode|payment-postal-?code|payment[^/]*postal-?code)/i,
};

function getCardEnv() {
  const num = process.env.TOPUP_CARD_NUMBER ?? '';
  const exp = process.env.TOPUP_CARD_EXP ?? '';
  const cvc = process.env.TOPUP_CARD_CVC ?? '';
  const zip = process.env.TOPUP_CARD_ZIP ?? '';
  if (!num || !exp || !cvc) return null;
  return { num, exp, cvc, zip };
}

async function findStripeFrame(page, pat) {
  for (const f of page.frames()) {
    if (pat.test(f.url())) return f;
  }
  return null;
}

// Autocomplete-driven fill works across both layouts:
// (a) split layout — separate iframe per field, URL like elements-inner-card-number
// (b) unified layout — all inputs in one frame (elements-inner-accessory-target,
//     iproyal/clover variant). Inputs are named by autocomplete attribute:
//     cc-number / cc-exp / cc-csc / billing postal-code.
const AUTOCOMPLETE_FIELD_MAP = {
  cardNumber: 'cc-number',
  cardExpiry: 'cc-exp',
  cardCvc: 'cc-csc',
  postalCode: 'billing postal-code',
};

async function findInputByAutocomplete(page, autocomplete) {
  for (const f of page.frames()) {
    if (!/stripe\.com|m\.stripe\.network/.test(f.url())) continue;
    try {
      const handle = await f.$(`input[autocomplete="${autocomplete}"]`);
      if (handle) {
        const visible = await handle.isVisible().catch(() => false);
        if (visible) return { frame: f, handle };
      }
    } catch {}
  }
  return null;
}

export async function fillStripeElements(page, card = null) {
  const c = card ?? getCardEnv();
  if (!c) return { ok: false, reason: 'no_card_env' };
  // Stripe mounts its card frames once the checkout page has settled; each of
  // those frames then loads on its own, and the card input is read after both.
  await pageSettled(page);
  await Promise.all(
    page
      .frames()
      .filter((f) => /stripe\.com|m\.stripe\.network/.test(f.url()))
      .map((f) => f.waitForLoadState('load')),
  );
  const cardEntry = await findInputByAutocomplete(page, 'cc-number');
  if (!cardEntry) return { ok: false, reason: 'cc-number_input_not_found' };
  const filled = {};
  for (const [field, autocomplete] of Object.entries(AUTOCOMPLETE_FIELD_MAP)) {
    const value =
      field === 'cardNumber'
        ? c.num
        : field === 'cardExpiry'
          ? c.exp
          : field === 'cardCvc'
            ? c.cvc
            : c.zip;
    if (!value) {
      filled[field] = 'no_value';
      continue;
    }
    const entry =
      field === 'cardNumber'
        ? cardEntry
        : await findInputByAutocomplete(page, autocomplete);
    if (!entry) {
      filled[field] = 'input_not_found';
      continue;
    }
    try {
      await entry.handle.click({ force: true });
      // A field that cannot be cleared would take the typed digits after
      // whatever it already held: a card number or expiry Stripe charges
      // wrong. Its failure is the field's err:, not a silent 'filled'.
      await entry.handle.fill('');
      await humanType(page, value);
      filled[field] = 'filled';
    } catch (e) {
      filled[field] = `err:${e.message}`;
    }
  }
  const ok =
    filled.cardNumber === 'filled' &&
    filled.cardExpiry === 'filled' &&
    filled.cardCvc === 'filled';
  return { ok, filled };
}

// The purchase card can come from one declared JSON secret or a local card
// file. A supplied but invalid JSON secret must not silently select a file.
export const TOPUP_ENV_FILES = [
  join(homedir(), '.weles', 'topup_card.env'),
  join(homedir(), '.stado', 'topup_card.env'),
];
export const TOPUP_REQUIRED = [
  'TOPUP_CARD_NUMBER',
  'TOPUP_CARD_EXP',
  'TOPUP_CARD_CVC',
];

// Load the explicit card source into the trajectory environment. Conflicting
// values refuse rather than mixing credentials from separate sources.
export function loadTopupCardEnv() {
  if (Object.hasOwn(process.env, 'TOPUP_CARD_JSON')) {
    const bundled = process.env.TOPUP_CARD_JSON;
    if (!bundled?.trim())
      throw new Error(
        'TOPUP_CARD_JSON was supplied empty; the purchase card was not selected',
      );
    let card;
    try {
      card = JSON.parse(bundled);
    } catch (error) {
      throw new Error(
        `TOPUP_CARD_JSON is not valid JSON: ${error.message}; the purchase card was not selected`,
        { cause: error },
      );
    }
    if (!card || typeof card !== 'object' || Array.isArray(card))
      throw new Error(
        'TOPUP_CARD_JSON must be a card object; the purchase card was not selected',
      );
    const mapping = {
      TOPUP_CARD_NUMBER: card.number,
      TOPUP_CARD_EXP: card.exp,
      TOPUP_CARD_CVC: card.cvc,
      TOPUP_CARD_ZIP: card.zip,
      TOPUP_CARD_NAME: card.name,
    };
    const missing = TOPUP_REQUIRED.filter(
      (key) => typeof mapping[key] !== 'string' || !mapping[key].trim(),
    );
    if (missing.length)
      throw new Error(
        `TOPUP_CARD_JSON has no ${missing.join(', ')}; the purchase card was not selected`,
      );
    for (const [key, value] of Object.entries(mapping)) {
      if (value === undefined || value === null || value === '') continue;
      if (process.env[key] && process.env[key] !== String(value))
        throw new Error(
          `${key} conflicts with TOPUP_CARD_JSON; no card was selected`,
        );
      process.env[key] = String(value);
    }
    return 'TOPUP_CARD_JSON';
  }
  for (const path of TOPUP_ENV_FILES) {
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (k && v && !process.env[k]) process.env[k] = v;
    }
    return path;
  }
  return null;
}
