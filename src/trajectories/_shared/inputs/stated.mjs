// Values a run cannot know by itself (how many, how far, where on the page)
// are stated by its caller in the environment. These readers refuse a missing
// or malformed value by name, saying what it decides, instead of assuming one.

function refuse(name, raw, shape, what) {
  return new Error(
    `${name} is ${raw ? `"${raw}", not ${shape}` : 'not set'}: ${what}; nothing is assumed`,
  );
}

/** A whole number above zero, stated in `name`. */
export function statedCount(name, what) {
  const raw = process.env[name];
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || !(value >= Number.MIN_VALUE)) {
    throw refuse(name, raw, 'a whole number above zero', what);
  }
  return value;
}

/** A whole number of zero or more, stated in `name`. */
export function statedBudget(name, what) {
  const raw = process.env[name];
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value) || value !== Math.abs(value)) {
    throw refuse(name, raw, 'a whole number of zero or more', what);
  }
  return value;
}

/** Any finite number, stated in `name`. */
export function statedNumber(name, what) {
  const raw = process.env[name];
  const value = Number(raw);
  if (!raw || !Number.isFinite(value))
    throw refuse(name, raw, 'a number', what);
  return value;
}

/** Non-empty text from the first of `names` that is set (identifiers, ids). */
export function statedText(names, what) {
  const name = names.find((candidate) => process.env[candidate]?.trim());
  if (!name)
    throw new Error(
      `none of ${names.join(', ')} is set: ${what}; nothing is assumed`,
    );
  return process.env[name].trim();
}

/**
 * One of the keys of `table`, stated in the first of `names` that is set
 * (an action, a resource, a destination). Unset or not a key: refused by name
 * with the keys that are, never a default.
 */
export function statedChoice(names, table, what) {
  const keys = Object.keys(table).join(', ');
  const choice = statedText(names, `${what}: one of ${keys}`).toLowerCase();
  if (!Object.hasOwn(table, choice))
    throw new Error(
      `${names.join(' / ')} is "${choice}", not one of ${keys}: ${what}; nothing is assumed`,
    );
  return choice;
}
