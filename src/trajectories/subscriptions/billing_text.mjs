// What the keeper billing collectors read from a billing page's text, by the
// shape the page gives it rather than by lists of words: a date as the page
// writes it, and an invoice row as a date line, an amount line and the line
// after them, whose text is the invoice's status exactly as the provider
// shows it.

/**
 * A date the page writes as month name, day and year, or as year-month-day,
 * as an ISO instant at UTC midnight; null when `text` holds none.
 */
export function dayIn(text) {
  const iso = /(?<day>\d+-\d+-\d+)/.exec(text);
  if (iso) {
    const day = new Date(`${iso.groups.day}T00:00:00Z`);
    return Number.isNaN(day.getTime()) ? null : day.toISOString();
  }
  const written = /(?<day>[A-Z][a-z]+\.? \d+, \d+)/.exec(text);
  if (written === null) return null;
  const day = new Date(`${written.groups.day} UTC`);
  return Number.isNaN(day.getTime()) ? null : day.toISOString();
}

/** The page's text as its non-empty lines. */
export function linesOf(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The invoice rows in `lines`: a line holding a date, then a line that is an
 * amount in the provider's currency (`amount` captures the number in a group
 * named amount), then the status line as the provider shows it.
 */
export function invoiceRows(lines, amount) {
  const rows = [];
  for (const [index] of lines.entries()) {
    const [dateLine, amountLine, statusLine] = lines.slice(index);
    if (statusLine === undefined) break;
    const date = dayIn(dateLine);
    const paid = amount.exec(amountLine);
    if (date === null || paid === null) continue;
    const amountUsd = Number(paid.groups.amount);
    if (Number.isNaN(amountUsd)) continue;
    rows.push({ date, amount_usd: amountUsd, status: statusLine });
  }
  return rows;
}
