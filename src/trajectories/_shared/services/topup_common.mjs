// Shared scaffolding for service-credential topup trajectories: the stated
// amount and confirmation, the purchase card and where it is loaded from, and
// Stripe Elements' card form.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { pageSettled } from '../page/settled.mjs';
import { clickOffered } from '../page/judged/seen.mjs';
import { humanType } from '../../../../dist/human/keyboard.js';

/**
 * The amount charged, TOPUP_USD, is the caller's: no amount is assumed; and
 * nothing is charged without TOPUP_CONFIRM=1.
 */
export function topupOpts() {
  const usd = Number(process.env.TOPUP_USD);
  if (!process.env.TOPUP_USD || !(usd >= Number.MIN_VALUE) || !Number.isFinite(usd))
    throw new Error(
      `TOPUP_USD is ${process.env.TOPUP_USD ? `"${process.env.TOPUP_USD}", not an amount above zero` : 'not set'}: the US dollars this top-up charges; nothing is assumed`,
    );
  if (process.env.TOPUP_CONFIRM !== '1')
    throw new Error('TOPUP_CONFIRM=1 is required before charging');
  return { usd };
}

// The provider's pay button, found by the vision model in whatever words the
// checkout uses; false when the page offers none.
export async function findAndClickPayButton(page) {
  const clicked = await clickOffered(page, 'the button that pays or checks out the top-up amount');
  if (clicked) console.log('[topup] clicked the pay button');
  return clicked;
}

/** A TOPUP_CARD_* value as the card source set it, or null when unset. */
function cardValue(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export const TOPUP_REQUIRED = ['TOPUP_CARD_NUMBER', 'TOPUP_CARD_EXP', 'TOPUP_CARD_CVC'];

/**
 * The workspace topup card from the environment its source set
 * (loadTopupCardEnv): number, expiry and CVC are required and refused by name
 * when missing; postal code, street, city and cardholder name are given when
 * set, STRIPE_PAY_NAME standing in for the name when stated.
 */
export function topupCard() {
  const missing = TOPUP_REQUIRED.filter((name) => cardValue(name) === null);
  if (missing.length)
    throw new Error(
      `TOPUP_CARD_MISSING: ${missing.join(', ')} not set by the card source, so no card can be entered`,
    );
  const stated = cardValue('STRIPE_PAY_NAME');
  return {
    num: cardValue('TOPUP_CARD_NUMBER').replace(/\s+/g, ''),
    exp: cardValue('TOPUP_CARD_EXP').replace(/\D/g, ''),
    cvc: cardValue('TOPUP_CARD_CVC'),
    zip: cardValue('TOPUP_CARD_ZIP'),
    street: cardValue('TOPUP_CARD_STREET'),
    city: cardValue('TOPUP_CARD_CITY'),
    name: stated === null ? cardValue('TOPUP_CARD_NAME') : stated,
  };
}

// Stripe Elements names its inputs by autocomplete attribute in both of its
// layouts (one frame per field, or every field in one frame): cc-number,
// cc-exp, cc-csc and billing postal-code.
const AUTOCOMPLETE_FIELD_MAP = {
  cardNumber: 'cc-number',
  cardExpiry: 'cc-exp',
  cardCvc: 'cc-csc',
  postalCode: 'billing postal-code',
};

const onStripe = (frame) => {
  if (!URL.canParse(frame.url())) return false;
  const host = new URL(frame.url()).hostname;
  return host.endsWith('stripe.com') || host.endsWith('stripe.network');
};

/** The visible Stripe input with this autocomplete, and its frame; null when no Stripe frame shows one. */
async function findInputByAutocomplete(page, autocomplete) {
  for (const frame of page.frames().filter(onStripe)) {
    const handle = await frame.$(`input[autocomplete="${autocomplete}"]`);
    if (handle && (await handle.isVisible())) return { frame, handle };
  }
  return null;
}

/**
 * Type `card` (topupCard() when the caller gives none) into Stripe Elements.
 * Answers `{ ok, filled }`: each field's outcome, and whether number, expiry
 * and CVC were all filled.
 */
export async function fillStripeElements(page, card) {
  const c = card === undefined ? topupCard() : card;
  // Stripe mounts its card frames once the checkout page has settled; each of
  // those frames then loads on its own, and the card input is read after both.
  await pageSettled(page);
  await Promise.all(page.frames().filter(onStripe).map((frame) => frame.waitForLoadState('load')));
  const cardEntry = await findInputByAutocomplete(page, 'cc-number');
  if (!cardEntry) return { ok: false, reason: 'cc-number_input_not_found' };
  const values = { cardNumber: c.num, cardExpiry: c.exp, cardCvc: c.cvc, postalCode: c.zip };
  const filled = {};
  for (const [field, autocomplete] of Object.entries(AUTOCOMPLETE_FIELD_MAP)) {
    if (!values[field]) {
      filled[field] = 'no_value';
      continue;
    }
    const entry = field === 'cardNumber' ? cardEntry : await findInputByAutocomplete(page, autocomplete);
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
      await humanType(page, values[field]);
      filled[field] = 'filled';
    } catch (error) {
      filled[field] = `err:${error.message}`;
    }
  }
  const ok = filled.cardNumber === 'filled' && filled.cardExpiry === 'filled' && filled.cardCvc === 'filled';
  return { ok, filled };
}

// The purchase card comes from one declared JSON secret, a local card file,
// or the environment the worker already set. A supplied but invalid JSON
// secret never silently selects a file.
export const TOPUP_ENV_FILES = [
  join(homedir(), '.weles', 'topup_card.env'),
  join(homedir(), '.stado', 'topup_card.env'),
];

/** TOPUP_CARD_JSON's card, set into the environment; conflicting values refuse. */
function loadCardJson(bundled) {
  if (!bundled.trim())
    throw new Error('TOPUP_CARD_JSON was supplied empty; the purchase card was not selected');
  let card;
  try {
    card = JSON.parse(bundled);
  } catch (error) {
    throw new Error(`TOPUP_CARD_JSON is not valid JSON: ${error.message}; the purchase card was not selected`, {
      cause: error,
    });
  }
  if (!card || typeof card !== 'object' || Array.isArray(card))
    throw new Error('TOPUP_CARD_JSON must be a card object; the purchase card was not selected');
  const mapping = {
    TOPUP_CARD_NUMBER: card.number,
    TOPUP_CARD_EXP: card.exp,
    TOPUP_CARD_CVC: card.cvc,
    TOPUP_CARD_ZIP: card.zip,
    TOPUP_CARD_NAME: card.name,
  };
  const missing = TOPUP_REQUIRED.filter((key) => typeof mapping[key] !== 'string' || !mapping[key].trim());
  if (missing.length)
    throw new Error(`TOPUP_CARD_JSON has no ${missing.join(', ')}; the purchase card was not selected`);
  for (const [key, value] of Object.entries(mapping)) {
    if (value === undefined || value === null || value === '') continue;
    if (process.env[key] && process.env[key] !== String(value))
      throw new Error(`${key} conflicts with TOPUP_CARD_JSON; no card was selected`);
    process.env[key] = String(value);
  }
}

/** A card file's KEY=value lines, set into the environment where it holds no value yet. */
function loadCardFile(path) {
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [name, ...rest] = line.split('=');
    const key = name.trim();
    const value = rest.join('=').trim().replace(/^["']|["']$/g, '');
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

/**
 * Load the purchase card into the trajectory environment and answer where it
 * came from: 'TOPUP_CARD_JSON', a card file's path, or 'environment' when the
 * worker already set TOPUP_CARD_*. No source at all is refused.
 */
export function loadTopupCardEnv() {
  if (Object.hasOwn(process.env, 'TOPUP_CARD_JSON')) {
    loadCardJson(process.env.TOPUP_CARD_JSON);
    return 'TOPUP_CARD_JSON';
  }
  const file = TOPUP_ENV_FILES.find((path) => existsSync(path));
  if (file) {
    loadCardFile(file);
    return file;
  }
  if (TOPUP_REQUIRED.every((name) => cardValue(name) !== null)) return 'environment';
  throw new Error(
    `TOPUP_CARD_MISSING: no purchase card: TOPUP_CARD_JSON, a card file at ${TOPUP_ENV_FILES.join(' or ')}, or TOPUP_CARD_NUMBER/EXP/CVC in the environment is required`,
  );
}
