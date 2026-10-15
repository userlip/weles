// The GENERIC_TASK_* environment a queued generic task arrives as, read into
// the shapes browser_task.mjs runs on. A malformed input is refused by name,
// never dropped.

/** The named variable when it is a non-empty string; undefined otherwise. */
export function envString(name) {
  const value = process.env[name];
  return typeof value === 'string' && value ? value : undefined;
}

/** The task URL, which has to be an absolute http(s) URL. */
export function requireHttpUrl(raw) {
  if (!raw || !URL.canParse(raw))
    throw new Error(`GENERIC_TASK_URL must be a valid URL, not ${JSON.stringify(raw)}`);
  const parsed = new URL(raw);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error(`GENERIC_TASK_URL must be http(s), not ${parsed.protocol}`);
  return parsed.toString();
}

/**
 * The task's environment hints: UPPER_SNAKE keys with scalar JSON values,
 * each as a string. Any other key, or a null, object or list value, is
 * refused.
 */
export function safeStringMap(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('GENERIC_TASK_ENV must be a JSON object of UPPER_SNAKE keys');
  return Object.fromEntries(
    Object.entries(value).map(([key, raw]) => {
      if (!/^[A-Z_][A-Z\d_]*$/.test(key))
        throw new Error(`GENERIC_TASK_ENV key ${JSON.stringify(key)} is not UPPER_SNAKE`);
      if (raw === null || typeof raw === 'object')
        throw new Error(`GENERIC_TASK_ENV ${key} holds a null, an object or a list, not a scalar`);
      return [key, String(raw)];
    }),
  );
}

/**
 * A replay: a non-empty list of {tool, args, result?} steps; undefined when
 * the task names none. A malformed step is refused with its position.
 */
export function normalizedReplay(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length)
    throw new Error('GENERIC_TASK_REPLAY must be a non-empty list of steps');
  return value.map((raw, position) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.tool !== 'string' || !raw.tool)
      throw new Error(`GENERIC_TASK_REPLAY step ${position} names no tool`);
    if (raw.args !== undefined && (!raw.args || typeof raw.args !== 'object' || Array.isArray(raw.args)))
      throw new Error(`GENERIC_TASK_REPLAY step ${position} has args that are not an object`);
    const step = { tool: raw.tool, args: raw.args ? raw.args : {} };
    if (typeof raw.result === 'string') step.result = raw.result;
    return step;
  });
}
