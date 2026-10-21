import { CDPConnection } from '../cdp/connection.js';
import { CDPPage } from '../cdp/page/page.js';

/**
 * What every page of a context presents: the user agent, viewport, device
 * scale, Accept-Language and platform. The caller states each from the
 * persona it launched; a context has no identity of its own to fall back to.
 */
export interface EmulationSettings {
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
  acceptLanguage: string;
  platform: string;
}

export interface BrowserContextOptions {
  emulation: EmulationSettings;
  recordVideo?: boolean;
  proxyAuth?: { username: string; password: string };
}

export class CDPBrowserContext {
  private _connection: CDPConnection;
  private _browserContextId: string;
  private _recordVideo: boolean;
  private _proxyAuth?: { username: string; password: string };
  private _pages: CDPPage[] = [];
  private _initScripts: string[] = [];
  readonly _emulation: EmulationSettings;

  constructor(
    connection: CDPConnection,
    browserContextId: string,
    options: BrowserContextOptions,
  ) {
    this._connection = connection;
    this._browserContextId = browserContextId;
    this._emulation = { ...options.emulation };
    this._recordVideo = options.recordVideo === true;
    this._proxyAuth = options.proxyAuth;
  }

  addInitScript(script: string): void {
    this._initScripts.push(script);
  }

  private async _initPage(
    targetId: string,
    sessionId: string,
  ): Promise<CDPPage> {
    const page = new CDPPage(this._connection, targetId, sessionId, this);
    await page.init();
    if (this._proxyAuth) await page.setProxyAuth(this._proxyAuth);
    await this._connection.send(
      'Emulation.setUserAgentOverride',
      {
        userAgent: this._emulation.userAgent,
        acceptLanguage: this._emulation.acceptLanguage,
        platform: this._emulation.platform,
      },
      sessionId,
    );
    await this._connection.send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: this._emulation.viewportWidth,
        height: this._emulation.viewportHeight,
        deviceScaleFactor: this._emulation.deviceScaleFactor,
        mobile: false,
      },
      sessionId,
    );
    for (const script of this._initScripts) {
      await this._connection.send(
        'Page.addScriptToEvaluateOnNewDocument',
        { source: script },
        sessionId,
      );
    }
    this._pages.push(page);
    return page;
  }

  async newPage(): Promise<CDPPage> {
    const { targetId } = await this._connection.send('Target.createTarget', {
      url: 'about:blank',
      browserContextId: this._browserContextId,
    });
    const { sessionId } = await this._connection.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const page = await this._initPage(targetId, sessionId);
    // Auto-attach to popups opened from this page
    await this._connection.send(
      'Target.setAutoAttach',
      {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      },
      sessionId,
    );
    this._connection.on(
      'Target.attachedToTarget',
      (params: any) => {
        const info = params.targetInfo;
        if (
          info?.type === 'page' &&
          info.browserContextId === this._browserContextId
        ) {
          // A popup that could not be initialised runs without the init
          // scripts and is not tracked for close(), so the cause is said.
          this._initPage(info.targetId, params.sessionId).catch((error) => {
            console.error(
              `[async_api] popup ${info.targetId} runs without page initialisation: ${error}`,
            );
          });
        }
      },
      sessionId,
    );
    return page;
  }

  async addCookies(cookies: Array<Record<string, unknown>>): Promise<void> {
    for (const cookie of cookies) {
      const c = { ...cookie };
      // A cookie named by its domain is set for that host's origin; its own
      // path, when it has one, travels with it.
      if (!c.url && c.domain) {
        const scheme = c.secure ? 'https' : 'http';
        c.url = `${scheme}://${String(c.domain).replace(/^\./, '')}`;
      }
      await this._connection.send('Network.setCookie', c);
    }
  }

  async cookies(urls?: string[]): Promise<Array<Record<string, unknown>>> {
    const params: Record<string, any> = {};
    if (urls) params.urls = urls;
    const { cookies } = await this._connection.send(
      'Network.getCookies',
      params,
    );
    return cookies;
  }

  async clearCookies(): Promise<void> {
    await this._connection.send('Network.clearBrowserCookies', {});
  }

  /**
   * Closes every page (a page already closed answers at once) and disposes
   * the context; a page that could not be closed is named after the context
   * is disposed.
   */
  async close(): Promise<void> {
    const pages = this._pages;
    this._pages = [];
    const closed = await Promise.allSettled(pages.map((page) => page.close()));
    await this._connection.send('Target.disposeBrowserContext', {
      browserContextId: this._browserContextId,
    });
    const failed = closed.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failed.length)
      throw new AggregateError(
        failed,
        `closing the browser context left ${failed.length} page(s) unclosed: ${failed.map(String).join('; ')}`,
      );
  }

  get pages(): readonly CDPPage[] {
    return this._pages;
  }

  get browserContextId(): string {
    return this._browserContextId;
  }
}
