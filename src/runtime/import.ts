import { readFile, stat } from 'node:fs/promises';
import { welesApiConnection } from './api/connection.js';

// The size limits of an import are the endpoint's: weles-web refuses a
// request it will not take and says so, and that refusal is what the caller
// reads. No second copy of them is kept here.
const HOST_RE = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/; // https://www.rfc-editor.org/rfc/rfc1035#section-2.3.4 a host name is at most 253 characters

export type WelesImportItem = {
  source_id: string;
  name: string;
  action: string;
  state: 'imported' | 'unchanged' | 'refused';
  trajectory_id: string | null;
  status: string | null;
  reason: string | null;
};

export type WelesImportReport = {
  schema: 'weles.seed-import.v1';
  ok: true;
  organization_id: string;
  execution_host: string;
  imported: number;
  unchanged: number;
  refused: number;
  items: WelesImportItem[];
};

export type WelesImportClientOptions = {
  endpoint?: string;
  bearer?: string;
  organizationId?: string;
  environment?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isItem(value: unknown): value is WelesImportItem {
  return (
    isObject(value) &&
    typeof value.source_id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.action === 'string' &&
    typeof value.state === 'string' &&
    (value.trajectory_id === null || typeof value.trajectory_id === 'string') &&
    (value.status === null || typeof value.status === 'string') &&
    (value.reason === null || typeof value.reason === 'string')
  );
}

function parseReport(
  value: unknown,
  organizationId: string,
  targetHost: string,
): WelesImportReport {
  if (!isObject(value) || !Array.isArray(value.items) || !value.items.every(isItem))
    throw new Error(
      `Weles returned an invalid import result: ${JSON.stringify(value)}`,
    );
  const items = value.items as WelesImportItem[];
  // Each count is the number of items reported in that state, which also
  // proves it a whole number that is not negative; the three together cover
  // every item, so no item carries a state the report does not count.
  const tally = (state: WelesImportItem['state']) =>
    items.filter((item) => item.state === state).length;
  if (
    value.schema !== 'weles.seed-import.v1' ||
    value.ok !== true ||
    value.organization_id !== organizationId ||
    value.execution_host !== targetHost ||
    value.imported !== tally('imported') ||
    value.unchanged !== tally('unchanged') ||
    value.refused !== tally('refused') ||
    tally('imported') + tally('unchanged') + tally('refused') !== items.length
  ) {
    throw new Error(
      `Weles returned an unsupported import result: ${JSON.stringify(value)}`,
    );
  }
  return value as WelesImportReport;
}

export async function importWelesTrajectoryDocument(
  source: unknown,
  targetHost: string,
  options: WelesImportClientOptions = {},
): Promise<WelesImportReport> {
  const connection = welesApiConnection('/api/v1/imports', options);
  const host = targetHost.trim().toLowerCase().replace(/\.+$/, '');
  if (!HOST_RE.test(host))
    throw new Error('--host must be the exact managed Weles worker hostname');
  if (!isObject(source))
    throw new Error('trajectory export must be a JSON object');

  let sourceJson: string;
  try {
    sourceJson = JSON.stringify(source);
  } catch (error) {
    throw new Error(
      `trajectory export must be JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const requestBody = `{"source":${sourceJson},"target_host":${JSON.stringify(host)}}`;

  const response = await connection.fetch(connection.endpoint, {
    method: 'POST',
    headers: connection.headers,
    body: requestBody,
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Weles import endpoint returned non-JSON (HTTP ${response.status}): ${error instanceof Error ? error.message : String(error)}: ${text.trim()}`,
    );
  }
  if (!response.ok) {
    // The endpoint's own error when it states one, else its whole answer.
    const said =
      isObject(body) && typeof body.error === 'string'
        ? body.error
        : JSON.stringify(body);
    throw new Error(`Weles import failed with HTTP ${response.status}: ${said}`);
  }
  return parseReport(body, connection.organizationId, host);
}

export async function importWelesTrajectoryFile(
  path: string,
  targetHost: string,
  options: WelesImportClientOptions = {},
): Promise<WelesImportReport> {
  const metadata = await stat(path).catch((error: unknown) => {
    throw new Error(
      `trajectory export ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!metadata.isFile())
    throw new Error(`trajectory export is not a regular file: ${path}`);
  const bytes = await readFile(path);
  let source: unknown;
  try {
    source = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `trajectory export ${path} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return importWelesTrajectoryDocument(source, targetHost, options);
}
