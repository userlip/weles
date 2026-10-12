// Reaching the right place: the account's stored phone, and the Accounts
// Center link, found by the vision model from its description
// (`_shared/page/judged/seen.mjs`). The phone's country is picked where the
// number is typed (`phone_steps.mjs`), from the number's own dialling code.
import { pageSettled } from '../../../_shared/page/settled.mjs';
import { clickDescribed } from '../../../_shared/page/judged/seen.mjs';
import { normalizePhone, phoneNationalNumber } from './page.mjs';

export async function loadAccountPhone(page, preferredCountry) {
  await page.goto(
    'https://accountscenter.facebook.com/youraccount/contact_points/',
    {
      waitUntil: 'domcontentloaded',
    },
  );
  await pageSettled(page);
  const rawPhones = await page.evaluate(() => {
    const textOf = (el) =>
      [
        el.innerText || '',
        el.textContent || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || '',
      ].join(' ');
    const text = [
      document.body?.innerText || '',
      document.body?.textContent || '',
      ...Array.from(
        document.querySelectorAll(
          'button, [role="button"], a, input, [aria-label], [title]',
        ),
      ).map(textOf),
    ].join(' ');
    const matches = text.match(/\+\d[\d\s().-]{6,}\d/g) || [];
    return Array.from(new Set(matches));
  });
  const candidates = rawPhones
    .map(normalizePhone)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.country === preferredCountry && b.country !== preferredCountry)
        return -1;
      if (b.country === preferredCountry && a.country !== preferredCountry)
        return 1;
      return b.digitCount - a.digitCount;
    });
  const selected = candidates[0] || null;
  if (!selected) return null;
  console.log(
    JSON.stringify(
      {
        stage: 'account_phone_candidate_loaded',
        country: selected.country,
        digitCount: selected.digitCount,
        nationalDigitCount: phoneNationalNumber(selected.phone).length,
        candidates: candidates.length,
      },
      null,
      2,
    ),
  );
  return selected.phone;
}

export async function clickAccountsCenter(page) {
  const target = await clickDescribed(
    page,
    'the enabled link or button on the verification page that opens Accounts Center',
  );
  console.log(
    JSON.stringify({ stage: 'clicked', label: 'accounts_center', ...target }),
  );
  return true;
}
