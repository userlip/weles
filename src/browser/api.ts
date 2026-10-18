import { type ChildProcess } from 'node:child_process';
import { type Server } from 'node:http';
import { CDPConnection } from '../cdp/connection.js';
import { launchChromium } from '../cdp/launcher.js';
import {
  generate,
  toConfig,
  toCppConfig,
  type FingerprintConfig,
} from '../fingerprint.js';
import { buildInitScript } from '../page-init/loader.js';
import { startCredentialForwarder } from './api/credential-forwarder.js';
import { CDPBrowserContext } from './context.js';

export interface WelesLaunchOptions {
  /** The operating system the fingerprint imitates: macos, windows or linux. */
  os: string;
  config?: Partial<FingerprintConfig>;
  proxy?: string;
  locale?: string;
  headless?: boolean;
  userDataDir?: string;
  excludeScripts?: string[];
  chromiumPath?: string;
  recordVideo?: boolean;
}

/** The locale the operator's shell declares in LANG, else the one Intl resolves. */
function getSystemLocale(): string {
  const lang = process.env.LANG;
  if (lang) {
    const [base] = lang.split('.');
    return base.replace('_', '-');
  }
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

export class CDPWeles {
  private _process: ChildProcess;
  private _connection: CDPConnection;
  private _context: CDPBrowserContext;
  private _localProxy?: Server;

  private constructor(
    proc: ChildProcess,
    connection: CDPConnection,
    context: CDPBrowserContext,
    localProxy?: Server,
  ) {
    this._process = proc;
    this._connection = connection;
    this._context = context;
    this._localProxy = localProxy;
  }

  static async launch(options: WelesLaunchOptions): Promise<CDPWeles> {
    if (!options.os)
      throw new Error(
        'CDPWeles.launch needs options.os, the operating system the browser fingerprint imitates (macos, windows or linux)',
      );
    const locale = options.locale ?? getSystemLocale();
    const targetOs = options.os;
    const fp = generate({ os: targetOs, browser: 'chromium' });
    const config = toConfig(fp, targetOs, 'chromium');

    // A custom binary spoofs the fingerprint itself, so it gets no init script.
    const isCustomBinary = !!(
      options.chromiumPath || process.env.CHROMIUM_PATH
    );
    const initScript = isCustomBinary
      ? ''
      : buildInitScript(config, options.excludeScripts);

    // A proxy URL with credentials goes through a local forwarder, so Chrome
    // is never handed the upstream credentials.
    let proxyForChrome: string | undefined;
    let localProxy: Server | undefined;
    if (options.proxy) {
      let proxyUrl: URL;
      try {
        proxyUrl = new URL(options.proxy);
      } catch (error) {
        throw new Error(`options.proxy is not a URL: ${causeOf(error)}`);
      }
      if (proxyUrl.username) {
        const forwarder = await startCredentialForwarder(proxyUrl);
        proxyForChrome = forwarder.url;
        localProxy = forwarder.server;
      } else {
        proxyForChrome = options.proxy;
      }
    }

    const extraArgs: string[] = [];
    if (isCustomBinary) {
      const cppConfig = toCppConfig(config, targetOs, {
        chromiumPath: options.chromiumPath,
      });
      extraArgs.push(`--weles-fingerprint=${JSON.stringify(cppConfig)}`);
    }
    const {
      process: proc,
      wsUrl,
      proxyAuth,
    } = await launchChromium({
      headless: options.headless,
      chromiumPath: options.chromiumPath,
      userDataDir: options.userDataDir,
      proxyServer: proxyForChrome,
      args: extraArgs,
    });

    const connection = new CDPConnection();
    await connection.connect(wsUrl);
    const { browserContextId } = await connection.send(
      'Target.createBrowserContext',
      {},
    );
    const context = new CDPBrowserContext(connection, browserContextId, {
      recordVideo: options.recordVideo,
      proxyAuth,
    });

    // A custom binary sets the user agent and platform itself. The viewport
    // is the fingerprint's window width and screen height, the size the
    // fingerprint's outer window was derived from.
    context.setEmulation({
      userAgent: isCustomBinary ? '' : config.navigator.userAgent,
      viewportWidth: config.window.outerWidth,
      viewportHeight: config.screen.height,
      deviceScaleFactor: config.window.devicePixelRatio,
      acceptLanguage: locale,
      platform: isCustomBinary ? '' : config.navigator.platform,
    });
    if (initScript) context.addInitScript(initScript);

    // WebAuthn stub that keeps passkey prompts off Google SSO. It rejects with
    // NotAllowedError, as a browser without an authenticator does: a promise
    // that never settles makes Reddit's anti-bot read credentials over and
    // over, many times more often than a human session, which is a timing tell.
    context.addInitScript(
      `try{var _og=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=function(o){if(o&&o.publicKey){var exc=new DOMException('The operation is not supported.','NotAllowedError');return Promise.reject(exc)}return _og(o)}}catch(e){}`,
    );

    return new CDPWeles(proc, connection, context, localProxy);
  }

  get context(): CDPBrowserContext {
    return this._context;
  }

  /**
   * Closes the browser context, the DevTools connection, the browser process
   * and the local proxy, attempting every step even when an earlier one
   * fails. A connection the browser already closed, or a process that has
   * already exited, is not a failure; any other failure is collected and the
   * close rejects naming each step that failed and its cause, so a browser
   * left running is never reported as closed.
   */
  async close(): Promise<void> {
    const failures: string[] = [];
    if (!this._connection.closed) {
      try {
        await this._context.close();
      } catch (error) {
        failures.push(
          `browser context ${this._context.browserContextId}: ${causeOf(error)}`,
        );
      }
      try {
        await this._connection.close();
      } catch (error) {
        failures.push(`DevTools connection: ${causeOf(error)}`);
      }
    }
    const running =
      this._process.exitCode === null && this._process.signalCode === null;
    if (running && !this._process.kill())
      failures.push(
        `browser process ${this._process.pid} did not accept the termination signal`,
      );
    const proxy = this._localProxy;
    this._localProxy = undefined;
    if (proxy) {
      const { promise, resolve } = Promise.withResolvers<Error | undefined>();
      proxy.close((error) => resolve(error));
      const error = await promise;
      if (error) failures.push(`local proxy: ${error.message}`);
    }
    if (failures.length)
      throw new Error(
        `the Weles browser did not close cleanly: ${failures.join('; ')}`,
      );
  }
}

function causeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Launch a browser and return the context directly.
 * Convenience wrapper around CDPWeles.launch().
 */
export async function cdpNewBrowser(
  options: WelesLaunchOptions,
): Promise<CDPBrowserContext> {
  const weles = await CDPWeles.launch(options);
  return weles.context;
}
