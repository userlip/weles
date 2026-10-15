// The phone number a sign-up's phone field takes. The number is rented, for
// the platform, in the country the page has set the field to: the country
// selector beside the field names it (its value) and its calling code (the
// "+N" its chosen option shows), and the field then takes the digits after
// that code. A page with no country selector takes the whole international
// number, rented in the country the caller states in PHONE_COUNTRY. A rented
// number outside that country is refused before anything is typed.
import { statedText } from './stated.mjs';

/** The country select of `root` (a page or frame): a select whose options show calling codes. */
function countrySelector(root) {
  return root
    .locator('select')
    .filter({ has: root.locator('option', { hasText: /\+\d/ }) })
    .first();
}

/**
 * Rent a number for `service` in the field's country and answer what the
 * phone field takes. `root` is the page or frame the field is in.
 */
export async function phoneForField(s, root, service) {
  const selector = countrySelector(root);
  let country;
  let callingCode;
  if (await selector.count()) {
    const chosen = await selector.evaluate((select) => ({
      value: select.value,
      label: select.options[select.selectedIndex]?.textContent,
    }));
    callingCode = chosen.label?.match(/\+(?<digits>\d+)/)?.groups.digits;
    country = chosen.value;
    if (!country || !callingCode)
      throw new Error(
        `PHONE_COUNTRY_UNREAD: the ${service} phone field's country selector names no country and calling code (${JSON.stringify(chosen)})`,
      );
  } else {
    country = statedText(
      ['PHONE_COUNTRY'],
      `the country the ${service} phone number is rented in (the page shows no country selector)`,
    );
  }
  // A number no provider holds is refused by the rent itself, with each provider's answer.
  await s.checkSms(service, country.toUpperCase());
  const international = s.resolveEnv(`$${service.toUpperCase()}_NEW_PHONE`);
  if (!callingCode) return international;
  if (!international.startsWith(`+${callingCode}`))
    throw new Error(
      `PHONE_COUNTRY_MISMATCH: the rented number ${international} is not in the ${service} field's country (+${callingCode})`,
    );
  return international.slice(`+${callingCode}`.length);
}
