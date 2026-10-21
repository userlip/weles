// GET /diagnostics/:run_id (the run's evidence manifest) and
// GET /diagnostics/:run_id/file?path= (one file of it), token-authenticated.
// path=run-result.json with wait=terminal holds the read until the run has a
// persisted outcome.
import { createReadStream } from 'node:fs';
import { constants as http } from 'node:http2';
import { json, requireTokenAuthorization } from '../../http-exchange.mjs';
import {
  decodeRunId,
  diagnosticFile,
  diagnosticsContentType,
  diagnosticsManifest,
} from '../../run/run-evidence.mjs';
import { terminalRunResultFile } from '../../run/run-outcome.mjs';

const FILE_ROUTE = /^\/diagnostics\/(?<run>[^/]+)\/file$/;
const MANIFEST_ROUTE = /^\/diagnostics\/(?<run>[^/]+)$/;

export function isDiagnosticsRoute(req, url) {
  return (
    req.method === 'GET' &&
    (FILE_ROUTE.test(url.pathname) || MANIFEST_ROUTE.test(url.pathname))
  );
}

/** The run id the address names, or null once `res` answered it as invalid. */
function requestedRun(res, encoded) {
  const runId = decodeRunId(encoded);
  if (!runId)
    json(res, http.HTTP_STATUS_BAD_REQUEST, {
      ok: false,
      error: 'invalid_run_id',
    });
  return runId;
}

/** The terminal run-result.json once the run has one; undefined when the caller left first. */
async function terminalResult(res, runId) {
  const controller = new AbortController();
  const disconnect = () => controller.abort();
  res.once('close', disconnect);
  try {
    if (res.destroyed) return undefined;
    return await terminalRunResultFile(runId, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return undefined;
    throw error;
  } finally {
    res.off('close', disconnect);
  }
}

async function respondToFile(res, url, encoded) {
  const runId = requestedRun(res, encoded);
  if (!runId) return;
  const requestedPath = url.searchParams.get('path');
  const wait = url.searchParams.get('wait');
  if (
    wait !== null &&
    (wait !== 'terminal' || requestedPath !== 'run-result.json')
  ) {
    json(res, http.HTTP_STATUS_BAD_REQUEST, {
      ok: false,
      error: 'wait=terminal requires path=run-result.json',
    });
    return;
  }
  const file =
    wait === 'terminal'
      ? await terminalResult(res, runId)
      : diagnosticFile(runId, requestedPath);
  if (file === undefined) return;
  if (!file) {
    json(res, http.HTTP_STATUS_NOT_FOUND, {
      ok: false,
      error: 'diagnostic_file_not_found',
    });
    return;
  }
  res.writeHead(http.HTTP_STATUS_OK, {
    'Content-Type': diagnosticsContentType(file.path),
    'Content-Length': String(file.stat.size),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file.path)
    .on('error', (error) => {
      console.error(
        `[weles-api] diagnostic file ${file.path} could not be read while it was sent: ${error.message}`,
      );
      res.destroy(error);
    })
    .pipe(res);
}

function respondToManifest(res, encoded) {
  const runId = requestedRun(res, encoded);
  if (!runId) return;
  const manifest = diagnosticsManifest(runId);
  if (!manifest) {
    json(res, http.HTTP_STATUS_NOT_FOUND, {
      ok: false,
      error: 'diagnostics_not_found',
    });
    return;
  }
  json(res, http.HTTP_STATUS_OK, manifest);
}

export async function respondToDiagnostics(req, res, url) {
  if (!requireTokenAuthorization(req, res)) return;
  const file = FILE_ROUTE.exec(url.pathname);
  if (file) {
    await respondToFile(res, url, file.groups.run);
    return;
  }
  respondToManifest(res, MANIFEST_ROUTE.exec(url.pathname).groups.run);
}
