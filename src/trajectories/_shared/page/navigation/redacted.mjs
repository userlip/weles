// A page address fit for a log: its origin and path as they are, the value of
// every query parameter and the fragment replaced.
//
// The copies this replaces redacted a parameter only when its name matched a
// list of words (token, code, secret...), so a site that called its one-time
// code `otp` or its session `sid` had it printed. Which parameter carries a
// secret is the site's business, so none of their values is printed; the
// names stay, and they are what a reader needs to follow the flow.

const HIDDEN = '<redacted>';

/**
 * `rawUrl`, resolved against `base` when it is relative (a link's `href`
 * attribute), with every query value and the fragment redacted.
 */
export function redactedUrl(rawUrl, base) {
  if (!URL.canParse(rawUrl, base)) {
    throw new Error(
      `the page address could not be parsed as a URL, so it is not logged (${rawUrl.length} characters)`,
    );
  }
  const parsed = new URL(rawUrl, base);
  if (parsed.hash) parsed.hash = HIDDEN;
  for (const key of new Set(parsed.searchParams.keys())) {
    parsed.searchParams.set(key, HIDDEN);
  }
  return parsed.toString();
}
