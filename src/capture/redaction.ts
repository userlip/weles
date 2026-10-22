// What a capture's evidence keeps before it reaches the model: addresses,
// credentials, query and assigned values, opaque tokens, typed input values
// and identifier path segments are hidden, so no secret survives under a name
// nobody listed.

const EMAIL_PATTERN = new RegExp(
  '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b',
  'gi',
);
// A credential after an auth scheme word (Bearer, Basic, Token, …): the
// scheme stays readable and the long token after it is hidden.
const AUTH_PATTERN = new RegExp(
  '\\b([A-Z][A-Za-z]+)\\s+[A-Za-z0-9._~+/=-]{16,}',
  'g',
);
const JWT_PATTERN = new RegExp(
  '\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b',
  'g',
);
const QUERY_SECRET_PATTERN = new RegExp(
  '([?&][^=&#\\s"\\x27]+=)[^&#\\s"\\x27]*',
  'gi',
);
const NAMED_SECRET_PATTERN = new RegExp(
  '(["\\x27]?[A-Za-z_][\\w-]*["\\x27]?\\s*[:=]\\s*)("[^"]*"|\\x27[^\\x27]*\\x27)',
  'gi',
);
const OPAQUE_SECRET_PATTERN = new RegExp(
  '\\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_=-]{48,})\\b',
  'g',
);
const INPUT_TAG_PATTERN = new RegExp('<input\\b[^>]*>', 'gi');
const INPUT_VALUE_PATTERN = new RegExp(
  '\\svalue\\s*=\\s*("[^"]*"|\\x27[^\\x27]*\\x27|[^\\s>]+)',
  'gi',
);
const IDENTIFIER_PATH_PATTERN = new RegExp(
  '/(?:\\d{4,}|[0-9a-f]{16,}|[0-9a-f-]{24,})(?=/|$)',
  'gi',
);

/** `value` with every secret-shaped part replaced by a marker naming its kind. */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(EMAIL_PATTERN, '[REDACTED_EMAIL]')
    .replace(AUTH_PATTERN, '$1 [REDACTED]')
    .replace(JWT_PATTERN, '[REDACTED_JWT]')
    .replace(QUERY_SECRET_PATTERN, '$1[REDACTED]')
    .replace(NAMED_SECRET_PATTERN, '$1[REDACTED]')
    .replace(OPAQUE_SECRET_PATTERN, '[REDACTED_OPAQUE]')
    .replace(INPUT_TAG_PATTERN, (tag) =>
      tag.replace(INPUT_VALUE_PATTERN, ' value="[REDACTED]"'),
    );
}

/**
 * `rawUrl` without credentials, query, fragment or identifier path segments.
 * A value that is not a URL is hidden whole: nothing in it can be told safe.
 */
export function redactUrl(rawUrl: string): string {
  if (!URL.canParse(rawUrl)) return '[REDACTED_URL]';
  const parsed = new URL(rawUrl);
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(
    IDENTIFIER_PATH_PATTERN,
    '/[REDACTED_ID]',
  );
  return parsed.toString();
}
