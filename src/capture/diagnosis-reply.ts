// The model's diagnosis reply, read into its declared shape or refused with
// the first check it failed and the part of the reply that failed it.

/// One evidence source the diagnosis asked for and could not read: which
/// source, the path it was looked for at, and the cause the read gave.
export type UnreadEvidence = {
  source:
    | 'video_frames'
    | 'console_lines'
    | 'network_responses'
    | 'dom_snapshot';
  path: string;
  cause: string;
};

export type CaptureDiagnosis = {
  summary: string;
  errors: string[];
  anomalies: string[];
  next_steps: string[];
  unread_evidence: UnreadEvidence[];
};

/// The parsed model reply, or the first check it failed with the part of
/// the reply that failed it: the whole reply when no JSON object was found
/// or it did not parse, the offending field's value otherwise.
export type DiagnosisParse =
  | { diagnosis: Omit<CaptureDiagnosis, 'unread_evidence'> }
  | { failure: string; excerpt: string };

export function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringList(
  record: Record<string, unknown>,
  field: 'errors' | 'anomalies' | 'next_steps',
): { list: string[] } | { failure: string; excerpt: string } {
  const value = record[field];
  if (!Array.isArray(value)) {
    return {
      failure: `${field} is not an array`,
      excerpt: JSON.stringify(value),
    };
  }
  const offending = value.find((item) => typeof item !== 'string');
  if (offending !== undefined) {
    return {
      failure: `${field} holds a value that is not a string`,
      excerpt: JSON.stringify(offending),
    };
  }
  return { list: value as string[] };
}

/** The outermost `{…}` of `raw`, or nothing when the reply holds no braces in order. */
function outerObject(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (!raw.includes('{') || end <= start) return undefined;
  return `${raw.slice(start, end)}}`;
}

export function parseDiagnosisOutput(raw: string): DiagnosisParse {
  const text = outerObject(raw);
  if (text === undefined)
    return { failure: 'the reply holds no JSON object', excerpt: raw };
  let parsed: unknown;
  let unparsed: { cause: unknown } | undefined;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    unparsed = { cause: error };
  }
  if (unparsed)
    return {
      failure: `the JSON object does not parse: ${causeOf(unparsed.cause)}`,
      excerpt: text,
    };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { failure: 'the JSON value is not an object', excerpt: text };
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.summary !== 'string') {
    return {
      failure: 'summary is not a string',
      excerpt: JSON.stringify(record.summary),
    };
  }
  const errors = stringList(record, 'errors');
  if ('failure' in errors) return errors;
  const anomalies = stringList(record, 'anomalies');
  if ('failure' in anomalies) return anomalies;
  const nextSteps = stringList(record, 'next_steps');
  if ('failure' in nextSteps) return nextSteps;
  return {
    diagnosis: {
      summary: record.summary.trim(),
      errors: errors.list,
      anomalies: anomalies.list,
      next_steps: nextSteps.list,
    },
  };
}
