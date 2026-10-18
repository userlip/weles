#!/usr/bin/env node
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AsyncNewBrowserOptions } from './async_api.js';
import { callPageOperation } from './mcp/page-ops.js';
import {
  addBrowser,
  addPage,
  asString,
  dropBrowser,
  getPage,
  getBrowser,
  textResult,
} from './mcp/state.js';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

import { welesMcpTools } from './mcp/tools.js';

export { welesMcpTools } from './mcp/tools.js';

let consoleRoutedToStderr = false;

// MCP stdio is a protocol stream. Weles launch/session diagnostics use console.log;
// keep diagnostics on stderr while the server is active so stdout remains JSON-RPC only.
function routeConsoleToStderr(): void {
  if (consoleRoutedToStderr) return;
  console.log = (...args: unknown[]) => console.error(...args);
  consoleRoutedToStderr = true;
}

// The version the server reports in its initialize answer is the installed
// package's; a package file that cannot be read or names no version is a
// broken install, refused with its path rather than reported as "unknown".
function packageVersion(): string {
  const path = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
  if (typeof pkg.version !== 'string')
    throw new Error(`Weles package file ${path} names no version`);
  return pkg.version;
}

function browserOptions(args: Record<string, unknown>): AsyncNewBrowserOptions {
  const options: AsyncNewBrowserOptions = {};
  if (typeof args.headless === 'boolean') options.headless = args.headless;
  if (typeof args.browser === 'string') options.browser = args.browser;
  if (typeof args.os === 'string') options.os = args.os;
  if (typeof args.locale === 'string') options.locale = args.locale;
  if (typeof args.userDataDir === 'string')
    options.userDataDir = args.userDataDir;
  if (typeof args.proxy === 'string') options.proxy = { server: args.proxy };
  return options;
}

export async function callWelesMcpTool(
  name: string,
  args: Record<string, unknown> = {},
) {
  if (name === 'weles_browser_start') {
    routeConsoleToStderr();
    const { AsyncNewBrowser } = await import('./async_api.js');
    const context = await AsyncNewBrowser(browserOptions(args));
    return textResult({ browserId: addBrowser(context) });
  }

  if (name === 'weles_browser_close') {
    const browserId = asString(args.browserId, 'browserId');
    await dropBrowser(browserId).context.close();
    return textResult({ closed: browserId });
  }

  if (name === 'weles_page_new') {
    const browserId = asString(args.browserId, 'browserId');
    const page = await getBrowser(browserId).context.newPage();
    return textResult({ pageId: addPage(browserId, page) });
  }

  if (name === 'weles_page_goto') {
    const page = getPage(args.pageId);
    const url = asString(args.url, 'url');
    const waitUntil =
      typeof args.waitUntil === 'string'
        ? (args.waitUntil as
            | 'load'
            | 'domcontentloaded'
            | 'networkidle'
            | 'commit')
        : 'domcontentloaded';
    const response = await page.goto(url, { waitUntil });
    // Playwright answers no response for a navigation that stays on the
    // document (a hash change, about:blank); its status is then none.
    return textResult({
      url: page.url(),
      status: response ? response.status() : null,
      title: await page.title(),
    });
  }

  if (name === 'weles_page_text') {
    const page = getPage(args.pageId);
    const selector = typeof args.selector === 'string' ? args.selector : 'body';
    const text = await page.locator(selector).innerText();
    return textResult(text);
  }

  if (name === 'weles_page_click') {
    const page = getPage(args.pageId);
    await page.locator(asString(args.selector, 'selector')).click();
    return textResult({ clicked: args.selector });
  }

  if (name === 'weles_page_fill') {
    const page = getPage(args.pageId);
    const selector = asString(args.selector, 'selector');
    await page.locator(selector).fill(asString(args.value, 'value'));
    return textResult({ filled: selector });
  }

  if (name === 'weles_page_screenshot') {
    const page = getPage(args.pageId);
    const path = typeof args.path === 'string' ? args.path : undefined;
    const type = args.type === 'jpeg' ? 'jpeg' : 'png';
    const quality =
      type === 'jpeg' && typeof args.quality === 'number'
        ? args.quality
        : undefined;
    const shot = await page.screenshot({
      path,
      type,
      quality,
      fullPage: args.fullPage === true,
    });
    return textResult(
      path
        ? { path }
        : {
            mimeType: `image/${type}`,
            base64: Buffer.from(shot).toString('base64'),
          },
    );
  }

  if (name === 'weles_page_evaluate') {
    const page = getPage(args.pageId);
    const expression = asString(args.expression, 'expression');
    // Indirect eval runs the expression in the page's global scope.
    const value = await page.evaluate((source) => {
      const evaluate = eval;
      return evaluate(source);
    }, expression);
    // Always JSON text: a string value would otherwise reach the caller
    // unquoted and be indistinguishable from a JSON document.
    return textResult(JSON.stringify(value === undefined ? null : value));
  }

  const result = await callPageOperation(name, args);
  if (result) return result;
  throw new Error(`unknown tool: ${name}`);
}

function send(message: JsonRpcResponse | Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(request: JsonRpcRequest): Promise<void> {
  if (!request.method) return;
  // A request without an id is a notification and is answered by nothing;
  // JSON carries no undefined, so an id that is absent is one never sent.
  const { id } = request;
  if (id === undefined) return;

  try {
    if (request.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'weles', version: packageVersion() },
        },
      });
      return;
    }

    if (request.method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
      return;
    }

    if (request.method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: welesMcpTools } });
      return;
    }

    if (request.method === 'tools/call') {
      const { params } = request;
      if (!params) throw new Error('tools/call carries no params');
      const name = asString(params.name, 'name');
      const args =
        params.arguments && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
      const result = await callWelesMcpTool(name, args);
      send({ jsonrpc: '2.0', id, result });
      return;
    }

    send({
      jsonrpc: '2.0',
      id,
      // https://www.jsonrpc.org/specification#error_object (method not found)
      error: { code: -32601, message: `method not found: ${request.method}` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // https://www.jsonrpc.org/specification#error_object (server error range)
    send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  }
}

export function startMcpServer(): void {
  routeConsoleToStderr();
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    // Each request is one line; the text after the last newline is a request
    // still arriving and stays buffered for the next chunk.
    const lines = `${buffer}${chunk}`.split('\n');
    buffer = String(lines.pop());
    for (const received of lines) {
      const line = received.trim();
      if (!line) continue;
      let request: JsonRpcRequest;
      try {
        request = JSON.parse(line) as JsonRpcRequest;
      } catch (error) {
        const cause = error instanceof Error ? error.message : String(error);
        send({
          jsonrpc: '2.0',
          id: null,
          // https://www.jsonrpc.org/specification#error_object (parse error)
          error: { code: -32700, message: `parse error: ${cause}` },
        });
        continue;
      }
      void handle(request);
    }
  });
}

if (require.main === module) {
  startMcpServer();
}
