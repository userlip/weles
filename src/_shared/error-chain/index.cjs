// A thrown value described with every cause it wraps.
//
// Node's fetch throws TypeError('fetch failed') and keeps what actually failed
// (a DNS answer, a refused connection, a connect timeout, a TLS refusal) in
// error.cause; a connection tried on several addresses keeps one failure per
// address in an AggregateError's errors. A refusal that prints only the outer
// message names none of them, so every Weles refusal of a transport failure
// describes the thrown value through describeError. CommonJS, so both the
// ECMAScript modules and the TypeScript compiled to CommonJS import it.
'use strict';

// Node's own system errors say what failed and where in their own enumerable
// properties (errno, code, syscall, hostname, address, port, path, dest:
// https://nodejs.org/api/errors.html#class-systemerror), and every one of
// them names the system call that failed in `syscall`. Only a level carrying
// that has its fields named, so no other error's enumerable property (a
// server's response body, a URL with its query, a header, an item's value)
// is ever copied into a refusal; such a level is named by its message.
function systemFields(value) {
  if (typeof value.syscall !== 'string') return [];
  return Object.entries(value).filter(
    ([, field]) => typeof field === 'string' || typeof field === 'number',
  );
}

function level(value) {
  if (!(value instanceof Error)) return String(value);
  const named = value.message.trim() ? value.message : value.name;
  const fields = systemFields(value).map(([name, field]) => `${name} ${field}`);
  return fields.length ? `${named} (${fields.join(', ')})` : named;
}

/**
 * The message of `value` and of every cause under it, outermost first:
 * `fetch failed; caused by getaddrinfo ENOTFOUND auth.kimi.com (errno -3008,
 * code ENOTFOUND, syscall getaddrinfo, hostname auth.kimi.com)`. The failures
 * an AggregateError holds are each named; a cause met twice is named once.
 */
function describeError(value) {
  const seen = new Set();
  const walk = (current) => {
    if (seen.has(current)) return 'the cause named above';
    seen.add(current);
    if (!(current instanceof Error)) return level(current);
    const parts = [level(current)];
    if (current instanceof AggregateError && current.errors.length)
      parts.push(`each of [${current.errors.map(walk).join('; ')}]`);
    if (current.cause !== undefined) parts.push(`caused by ${walk(current.cause)}`);
    return parts.join('; ');
  };
  return walk(value);
}

/**
 * Every error under `value`, outermost first, as data a caller can test:
 * { name, message, fields } with fields holding the level's own system
 * properties (code, syscall, hostname, address, port). An AggregateError's
 * failures follow it in order; a value met twice is listed once.
 */
function causeChain(value) {
  const seen = new Set();
  const levels = [];
  const walk = (current) => {
    if (seen.has(current)) return;
    seen.add(current);
    if (!(current instanceof Error)) {
      levels.push({ name: typeof current, message: String(current), fields: {} });
      return;
    }
    levels.push({
      name: current.name,
      message: current.message,
      fields: Object.fromEntries(systemFields(current)),
    });
    if (current instanceof AggregateError) current.errors.forEach(walk);
    if (current.cause !== undefined) walk(current.cause);
  };
  walk(value);
  return levels;
}

exports.describeError = describeError;
exports.causeChain = causeChain;
