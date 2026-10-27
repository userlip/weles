// Reaching the right place: the account's stored phone in the stated
// country, read off Accounts Center by the vision model, and the Accounts
// Center link, found by it from its description
// (`_shared/page/judged/seen.mjs`).
import { pageSettled } from '../../../_shared/page/settled.mjs';
import {
  clickDescribed,
  shownText,
} from '../../../_shared/page/judged/seen.mjs';
import { statedPhone } from './settings.mjs';

/**
 * The phone the account lists as a contact point with dialling code
 * `countryCode`, as `{ countryCode, national }`. Refused when Accounts
 * Center lists none in that country.
 */
export async function loadAccountPhone(page, countryCode) {
  await page.goto(
    'https://accountscenter.facebook.com/youraccount/contact_points/',
    { waitUntil: 'domcontentloaded' },
  );
  await pageSettled(page);
  const listed = await shownText(
    page,
    `mobile number listed as a contact point whose dialling code is +${countryCode}, written with its + and dialling code`,
  );
  if (!listed)
    throw new Error(
      `META_ACCOUNT_PHONE_NOT_LISTED: Accounts Center lists no mobile number with dialling code +${countryCode}`,
    );
  const phone = statedPhone(
    listed,
    countryCode,
    `the account phone read off Accounts Center for +${countryCode}`,
  );
  console.log(
    JSON.stringify({
      stage: 'account_phone_loaded',
      countryCode: phone.countryCode,
      nationalDigitCount: phone.national.length,
    }),
  );
  return phone;
}

export async function clickAccountsCenter(page) {
  const target = await clickDescribed(
    page,
    'the enabled link or button on the verification page that opens Accounts Center',
  );
  console.log(
    JSON.stringify({ stage: 'clicked', label: 'accounts_center', ...target }),
  );
}
