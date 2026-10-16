// The page routes of the one Weles process: a rendered public page, read or
// exported, answered synchronously.
//
//   POST /pages/snapshot     { url, viewport?, load_state?, user_agent?, screenshot? }
//   POST /pages/form-export  { url, viewport?, load_state?, user_agent?, fields: [{ selector, value }], click_text }
//
// They exist so a product that needs a rendered page inside its own request
// (echo-web's caption renderer and competitor research) asks Weles instead of
// launching a browser of its own. Callers hold the general Weles API bearer.
// Every answer is { ok: true, data } or { ok: false, code, error }, and every
// request leaves one JSON line in the unit log naming the route, the target
// host, the outcome and how long it took, so a failing caller can be read from
// the host without reproducing it.
//
// At most CONCURRENT_PAGES pages are open at once, the number of processors
// the host reports; a request beyond that is refused with 429 and the count,
// never queued behind a browser it cannot see.

import {
  json,
  readBody,
  requireTokenAuthorization,
} from '../../http-exchange.mjs';
import {
  capturePageExport,
  capturePageSnapshot,
  PageLoadFailed,
} from './capture.mjs';
import {
  CONCURRENT_PAGES,
  HTTP_BUSY,
  HTTP_INVALID_REQUEST,
  HTTP_OK,
  HTTP_TARGET_REFUSED,
  HTTP_UPSTREAM_FAILED,
} from './constants.mjs';
import { PageTargetRefused } from './network.mjs';
import {
  formExportRequest,
  PageRequestRefused,
  snapshotRequest,
} from './request.mjs';

const ROUTES = {
  '/pages/snapshot': { parse: snapshotRequest, capture: capturePageSnapshot },
  '/pages/form-export': {
    parse: formExportRequest,
    capture: capturePageExport,
  },
};

const REFUSALS = [
  {
    type: PageRequestRefused,
    status: HTTP_INVALID_REQUEST,
    code: 'invalid_request',
  },
  {
    type: PageTargetRefused,
    status: HTTP_TARGET_REFUSED,
    code: 'target_refused',
  },
  { type: PageLoadFailed, status: HTTP_UPSTREAM_FAILED, code: 'page_failed' },
];
const BROWSER_FAILURE = {
  status: HTTP_UPSTREAM_FAILED,
  code: 'browser_failed',
};
const SERVED = { status: HTTP_OK, code: 'ok' };

/** The requests that hold an open page now; its size is the open count. */
const openPages = new Set();

export function isPageRoute(req, url) {
  return req.method === 'POST' && Object.hasOwn(ROUTES, url.pathname);
}

/**
 * The host the request asks for, for the log line. A body whose url does not
 * parse names none; the request parser refuses that body by itself.
 */
function targetHost(body) {
  const asked = body?.url;
  if (typeof asked !== 'string' || !URL.canParse(asked)) return null;
  return new URL(asked).hostname;
}

/**
 * The answer for a failed page: a refusal the page code classified keeps its
 * class; anything else went wrong while the browser rendered, so it is the
 * browser's failure.
 */
function refusalOf(error) {
  const classified = REFUSALS.find(({ type }) => error instanceof type);
  const { status, code } =
    classified === undefined ? BROWSER_FAILURE : classified;
  const message = error instanceof Error ? error.message : String(error);
  return { status, code, message };
}

export async function respondToPage(req, res, url, browser) {
  if (!requireTokenAuthorization(req, res)) return;
  if (openPages.size >= CONCURRENT_PAGES) {
    json(res, HTTP_BUSY, {
      ok: false,
      code: 'pages_busy',
      error: `pages_busy: ${openPages.size} of ${CONCURRENT_PAGES} pages are open`,
      open: openPages.size,
      limit: CONCURRENT_PAGES,
    });
    return;
  }
  openPages.add(req);
  const started = Date.now();
  let body = null;
  let outcome = SERVED;
  try {
    body = await readBody(req);
    const route = ROUTES[url.pathname];
    const data = await route.capture(browser, route.parse(body));
    json(res, HTTP_OK, { ok: true, data });
  } catch (error) {
    outcome = refusalOf(error);
    json(res, outcome.status, {
      ok: false,
      code: outcome.code,
      error: `${outcome.code}: ${outcome.message}`,
      ...(error instanceof PageRequestRefused ? { field: error.field } : {}),
    });
  } finally {
    openPages.delete(req);
    console.log(
      JSON.stringify({
        event: 'page_route',
        route: url.pathname,
        host: targetHost(body),
        status: outcome.status,
        code: outcome.code,
        ...(outcome.message ? { error: outcome.message } : {}),
        elapsed_ms: Date.now() - started,
      }),
    );
  }
}
