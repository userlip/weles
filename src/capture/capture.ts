import { mkdirSync, writeFileSync } from 'node:fs';
import { constants as http } from 'node:http2';
import { join } from 'node:path';
import { runRecordingsRoot } from '../session/run-recordings.js';
import { diagnoseCapture } from './diagnosis.js';

// A page's capture: console and network responses of a page it opened, and
// screenshots, DOM, environment and a diagnosis of any page, written under
// the run's recordings (or the directory the caller names).

export interface CDPPage {
  send(method: string, params?: Record<string, any>): Promise<any>;
  on(event: string, cb: (params: any) => void): void;
  off(event: string, cb: (params: any) => void): void;
  screenshot?(options?: { type?: string }): Promise<Buffer>;
  content?(): Promise<string>;
  url?(): string;
}

export interface CDPBrowserContext {
  newPage(): Promise<CDPPage>;
}

export interface ResponseRecord {
  url: string;
  /** The request's method, as the page sent it; null when the request was not seen. */
  method: string | null;
  status: number;
  body: string;
  /** Whether `body` is base64, as CDP returned it. */
  base64Encoded?: boolean;
  /** Why `body` is empty when CDP could not return it (streamed, evicted, closed). */
  bodyError?: string;
}

/** The indentation of the JSON a person reads beside the recordings. */
const INDENT = '  ';

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** A console argument as text: its value when CDP sent one, else its description, else its type. */
function argumentText(arg: any): string {
  if (Object.hasOwn(arg, 'value')) return String(arg.value);
  if (typeof arg.description === 'string') return arg.description;
  return `<${arg.type}>`;
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class Capture {
  private _context: CDPBrowserContext;
  private _outDir?: string;
  consoleLogs: string[] = [];
  responseBodies: ResponseRecord[] = [];
  constructor(context: CDPBrowserContext, outputDir?: string) {
    this._context = context;
    this._outDir = outputDir;
  }

  private _dir(...segs: string[]): string {
    const root = this._outDir ? this._outDir : runRecordingsRoot();
    const d = join(root, ...segs);
    mkdirSync(d, { recursive: true });
    return d;
  }

  /** A new page whose console and network responses this capture records. */
  async newPage(): Promise<CDPPage> {
    const page = await this._context.newPage();
    page.on('Runtime.consoleAPICalled', (params: any) => {
      this.consoleLogs.push(
        `[${params.type}] ${params.args.map(argumentText).join(' ')}`,
      );
    });
    // Without the domain the capture has no console log at all; the failure
    // goes into the console log itself so the empty log carries its reason.
    await page
      .send('Runtime.enable')
      .catch((error: unknown) =>
        this.consoleLogs.push(
          `[capture] Runtime.enable failed, console events are not captured: ${failure(error)}`,
        ),
      );
    const methods = new Map<string, string>();
    page.on('Network.requestWillBeSent', (params: any) => {
      methods.set(params.requestId, params.request.method);
    });
    page.on('Network.responseReceived', (params: any) => {
      const { requestId, response } = params;
      const seen = methods.get(requestId);
      const record = {
        url: response.url,
        method: seen === undefined ? null : seen,
        status: response.status,
      };
      // A body CDP cannot return (streamed, evicted, a closed page) is kept
      // with the reason, not as an empty answer.
      page
        .send('Network.getResponseBody', { requestId })
        .then((answer: any) => {
          this.responseBodies.push({
            ...record,
            body: answer.body,
            base64Encoded: answer.base64Encoded,
          });
        })
        .catch((error: unknown) => {
          this.responseBodies.push({
            ...record,
            body: '',
            bodyError: failure(error),
          });
        });
    });
    await page
      .send('Network.enable')
      .catch((error: unknown) =>
        this.consoleLogs.push(
          `[capture] Network.enable failed, responses are not captured: ${failure(error)}`,
        ),
      );
    return page;
  }

  async screenshot(page: CDPPage, label: string): Promise<string> {
    const filePath = join(this._dir(), `${label}_${timestamp()}.png`);
    let buf: Buffer;
    if (typeof page.screenshot === 'function') {
      buf = await page.screenshot({ type: 'png' });
    } else {
      const result = await page.send('Page.captureScreenshot', {
        format: 'png',
      });
      buf = Buffer.from(result.data, 'base64');
    }
    writeFileSync(filePath, buf);
    return filePath;
  }

  /**
   * The page's DOM, written beside the recordings: the rendered document a
   * browser page serves, or, for a bare CDP session, the outer HTML of its
   * document. A failed read is the caller's error.
   */
  async captureDom(page: CDPPage, label: string): Promise<string> {
    const dir = this._dir();
    if (typeof page.content === 'function') {
      const filePath = join(dir, `${label}_dom_${timestamp()}.html`);
      writeFileSync(filePath, await page.content());
      return filePath;
    }
    const { root } = await page.send('DOM.getDocument', { pierce: true });
    const { outerHTML } = await page.send('DOM.getOuterHTML', {
      nodeId: root.nodeId,
    });
    const filePath = join(dir, `${label}_dom_${timestamp()}.json`);
    writeFileSync(
      filePath,
      JSON.stringify({ tree: root, outerHTML }, null, INDENT),
    );
    return filePath;
  }

  /** The page's address, title, cookies, storage, user agent and viewport. */
  async captureEnvironment(page: CDPPage): Promise<any> {
    const collectScript = `(() => ({
      url: location.href,
      title: document.title,
      cookies: document.cookie,
      localStorage: Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])),
      userAgent: navigator.userAgent,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      timestamp: new Date().toISOString(),
    }))()`;
    const evaluated = await page.send('Runtime.evaluate', {
      expression: collectScript,
      returnByValue: true,
      awaitPromise: false,
    });
    if (evaluated.exceptionDetails)
      throw new Error(
        `the page's environment could not be read: ${evaluated.exceptionDetails.text}`,
      );
    const value = evaluated.result.value;
    writeFileSync(
      join(this._dir(), `environment_${timestamp()}.json`),
      JSON.stringify(value, null, INDENT),
    );
    return value;
  }

  /** Console log, responses and, given a page, its DOM, written to disk. */
  async save(label: string, page?: CDPPage): Promise<Record<string, string>> {
    const dir = this._dir();
    const ts = timestamp();
    const consolePath = join(dir, `${label}_console_${ts}.log`);
    writeFileSync(consolePath, this.consoleLogs.join('\n'));
    const responsesPath = join(dir, `${label}_responses_${ts}.json`);
    writeFileSync(
      responsesPath,
      JSON.stringify(this.responseBodies, null, INDENT),
    );
    return {
      console: consolePath,
      responses: responsesPath,
      ...(page ? { dom: await this.captureDom(page, label) } : {}),
    };
  }

  /** A diagnosis of the recording and the artefacts saved beside it. */
  async diagnose(
    videoPath: string,
    consolePath?: string,
    responsesPath?: string,
    domPath?: string,
  ): Promise<string> {
    return diagnoseCapture(
      this._dir('diagnosis_frames'),
      videoPath,
      consolePath,
      responsesPath,
      domPath,
    );
  }

  /** Save everything, diagnose the recording when one is given, and name the non-success responses. */
  async finish(
    label: string,
    options: { page?: CDPPage; videoPath?: string },
  ): Promise<{
    paths: Record<string, string>;
    diagnosis: string | null;
    trafficDiff: ResponseRecord[];
  }> {
    const paths = await this.save(label, options.page);
    const diagnosis = options.videoPath
      ? await this.diagnose(
          options.videoPath,
          paths.console,
          paths.responses,
          paths.dom,
        )
      : null;
    const trafficDiff = this.responseBodies.filter(
      (r) =>
        r.status < http.HTTP_STATUS_OK ||
        r.status >= http.HTTP_STATUS_MULTIPLE_CHOICES,
    );
    return { paths, diagnosis, trafficDiff };
  }
}
