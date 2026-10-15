// What a Keyword Planner run is asked for, read the same way by the browser
// planner, the keeper runner and the API intake: the Google Ads customer
// whose planner is read and the keywords looked up. A missing or empty value
// is refused with where it was looked for; nothing is assumed.

/** Text with every run of whitespace squashed to one space. */
export function squash(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The customer id's digits. Google prints an id with or without dashes; only
 * its digits name the customer. Refused when `value` holds none.
 */
export function customerIdOf(value, where) {
  const digits = value ? String(value).replace(/\D/g, '') : '';
  if (!digits)
    throw new Error(
      `GOOGLE_ADS_CUSTOMER_ID_REQUIRED: ${where} names no Google Ads customer id`,
    );
  return digits;
}

/**
 * A pattern matching the customer id as a page prints it: its digits in
 * order, with Google's dash or a space allowed between any two of them.
 */
export function customerIdPattern(customerId) {
  return new RegExp(customerId.split('').join('[- ]?'));
}

/**
 * The distinct keywords of `value`: a list, or text with one keyword per line
 * or comma. Refused when it names none.
 */
export function keywordsOf(value, where) {
  const items = Array.isArray(value)
    ? value.map(String)
    : value
      ? String(value).split(/[\n,]+/)
      : [];
  const keywords = [...new Set(items.map(squash).filter(Boolean))];
  if (!keywords.length)
    throw new Error(`GOOGLE_ADS_KEYWORDS_REQUIRED: ${where} names no keyword`);
  return keywords;
}
