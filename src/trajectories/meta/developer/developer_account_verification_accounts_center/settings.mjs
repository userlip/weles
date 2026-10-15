// The environment the developer verification runs with.
//
// The phone is stated with its country: META_VERIFY_PHONE (the national
// number, or the number written with + and its dialling code) and
// META_VERIFY_PHONE_COUNTRY_CODE (the dialling code, e.g. 48), or
// META_VERIFY_PHONE_FROM_ACCOUNT_COUNTRY (a dialling code) to use the phone
// the Meta account already lists in that country. A + number that does not
// carry its stated dialling code is refused; nothing guesses a country from a
// number's first digits.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const USER_DATA_DIR =
  process.env.WELES_USER_DATA_DIR ||
  process.env.ADS_PROFILE_DIR ||
  join(homedir(), '.weles', 'browser_profiles', 'meta_ads');
export const VERIFY_CODE = process.env.META_VERIFY_CODE;
export const CODE_ONLY = process.env.META_VERIFY_CODE_ONLY === '1';
export const OPEN_UPDATE_PHONE =
  process.env.META_VERIFY_OPEN_UPDATE_PHONE === '1';
mkdirSync(USER_DATA_DIR, { recursive: true });

function digitsOf(value) {
  return value.replace(/\D/g, '');
}

/**
 * A phone `{ countryCode, national }` from `number` and its stated dialling
 * code. A number written with + carries its dialling code, which must be the
 * stated one; a number without + is the national number. `where` names the
 * input in a refusal.
 */
export function statedPhone(number, countryCode, where) {
  if (!countryCode)
    throw new Error(`${where}: the dialling code of the number is not stated`);
  const code = digitsOf(countryCode);
  const digits = digitsOf(number);
  if (!code || !digits)
    throw new Error(`${where} names no phone number with its dialling code`);
  const international = number.trim().startsWith('+');
  if (international && !digits.startsWith(code))
    throw new Error(
      `${where}: the number does not carry the stated dialling code +${code}`,
    );
  return {
    countryCode: code,
    national: international ? digits.slice(code.length) : digits,
  };
}

/** The dialling code of the account phone to use, or null. */
export const PHONE_FROM_ACCOUNT_COUNTRY = process.env
  .META_VERIFY_PHONE_FROM_ACCOUNT_COUNTRY
  ? digitsOf(process.env.META_VERIFY_PHONE_FROM_ACCOUNT_COUNTRY)
  : null;

/** The stated phone, or null when the run states none. */
export const STATED_PHONE = process.env.META_VERIFY_PHONE
  ? statedPhone(
      process.env.META_VERIFY_PHONE,
      process.env.META_VERIFY_PHONE_COUNTRY_CODE,
      'META_VERIFY_PHONE with META_VERIFY_PHONE_COUNTRY_CODE',
    )
  : null;
