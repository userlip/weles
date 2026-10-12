/**
 * Unified CaptchaSolver — matches Python weles.captcha.solver API.
 * Wraps AntiCaptcha, 2captcha, CapSolver behind a single interface.
 */

import { getCaptchaCredentials } from '../utils/credentials.js';
import { costTracker } from '../utils/runtime/cost.js';
import { markCaptchaChallenge, markAllProvidersFailed } from './events.js';
import {
  apiSolve,
  type CaptchaCredentials,
  type ProxyCredentials,
} from './providers/api.js';
import { solveFuncaptchaToken } from './providers/funcaptcha.js';
import { solvePerimeterXCookies } from './providers/perimeterx.js';
import {
  solveRecaptchaV2Token,
  solveRecaptchaV3Token,
} from './providers/recaptcha_tokens.js';

type Page = any;

export class CaptchaSolver {
  private _creds: CaptchaCredentials;
  private _initialized = false;

  constructor(credentials?: CaptchaCredentials) {
    this._creds = credentials ?? {};
  }

  private async _ensureInit(): Promise<void> {
    if (this._initialized) return;
    if (
      !this._creds.anticaptcha &&
      !this._creds.twocaptcha &&
      !this._creds.capsolver
    ) {
      const db = await getCaptchaCredentials();
      this._creds = { ...db, ...this._creds };
    }
    this._initialized = true;
  }

  get availableServices(): string[] {
    const s: string[] = [];
    if (this._creds.anticaptcha) s.push('anticaptcha');
    if (this._creds.twocaptcha) s.push('twocaptcha');
    if (this._creds.capsolver) s.push('capsolver');
    if (this._creds.capmonster) s.push('capmonster');
    if (this._creds.nopecha) s.push('nopecha');
    if (this._creds.nocaptcha) s.push('nocaptcha');
    return s;
  }

  /** The solving services whose credentials Weles holds, read from Skarbiec first. */
  async configuredServices(): Promise<string[]> {
    await this._ensureInit();
    return this.availableServices;
  }

  async solveRecaptchaV2(
    page: Page,
    sitekey: string,
    options?: {
      enterprise?: boolean;
      invisible?: boolean;
      url?: string;
      proxy?: ProxyCredentials;
      dataS?: string;
    },
  ): Promise<string | boolean | null> {
    await this._ensureInit();
    return solveRecaptchaV2Token(this._creds, page, sitekey, options);
  }

  async solveRecaptchaV3(
    sitekey: string,
    url: string,
    action?: string,
    options?: {
      proxy?: ProxyCredentials;
      dataS?: string;
      enterprise?: boolean;
    },
  ): Promise<string | null> {
    await this._ensureInit();
    return solveRecaptchaV3Token(this._creds, sitekey, url, action, options);
  }

  async solveTurnstile(sitekey: string, url: string): Promise<string | null> {
    await this._ensureInit();
    markCaptchaChallenge(); // G8
    if (this._creds.capsolver) {
      const token = await apiSolve(
        'https://api.capsolver.com',
        this._creds.capsolver,
        {
          type: 'AntiTurnstileTaskProxyLess',
          websiteURL: url,
          websiteKey: sitekey,
        },
      );
      if (token) costTracker.recordCaptcha('capsolver', 'turnstile');
      if (!token) markAllProvidersFailed('turnstile'); // G8
      return token;
    }
    markAllProvidersFailed('turnstile'); // G8: no provider configured / all failed
    return null;
  }

  /**
   * Cloudflare managed/5s challenge (IUAM) via CapSolver AntiCloudflareTask.
   * Returns the cf_clearance cookie value + the userAgent that solved the challenge.
   * Caller MUST reuse the same proxy IP and userAgent when browsing with the cookie,
   * otherwise Cloudflare invalidates the clearance.
   */
  async solveCloudflare(
    url: string,
    options?: {
      proxy?: { server?: string; username?: string; password?: string };
      userAgent?: string;
    },
  ): Promise<{
    token: string;
    userAgent: string;
    cookies: Record<string, string>;
  } | null> {
    await this._ensureInit();
    markCaptchaChallenge(); // G8
    if (!this._creds.capsolver) {
      markAllProvidersFailed('cloudflare');
      return null;
    }
    const proxy = options?.proxy;
    let proxyStr = '';
    if (proxy?.server) {
      const u = new URL(proxy.server);
      const user = encodeURIComponent(proxy.username ?? '');
      const pass = encodeURIComponent(proxy.password ?? '');
      proxyStr = `${u.hostname}:${u.port || '80'}:${user}:${pass}`;
    }
    const task: Record<string, any> = {
      type: 'AntiCloudflareTask',
      websiteURL: url,
    };
    if (proxyStr) task.proxy = proxyStr;
    if (options?.userAgent) task.userAgent = options.userAgent;
    console.log(
      `[captcha:solver] solveCloudflare url=${url} proxy=${!!proxyStr} ua=${!!options?.userAgent}`,
    );
    const res = (await (
      await fetch('https://api.capsolver.com/createTask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this._creds.capsolver, task }),
      })
    ).json()) as any;
    if (res.errorId) {
      console.log(
        `[captcha:api] capsolver AntiCloudflare createTask err: ${res.errorCode} ${res.errorDescription}`,
      );
      markAllProvidersFailed('cloudflare');
      return null;
    }
    const taskId = res.taskId;
    if (!taskId) {
      console.log('[captcha:api] capsolver AntiCloudflare no taskId');
      markAllProvidersFailed('cloudflare');
      return null;
    }
    console.log(`[captcha:api] capsolver AntiCloudflare taskId=${taskId}`);
    // One read: CapSolver has no push or blocking answer.
    const tr = (await (
      await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: this._creds.capsolver, taskId }),
      })
    ).json()) as any;
    if (tr.errorId) {
      console.log(
        `[captcha:api] capsolver AntiCloudflare err: ${tr.errorCode} ${tr.errorDescription}`,
      );
      markAllProvidersFailed('cloudflare');
      return null;
    }
    if (tr.status !== 'ready') {
      console.log(
        `[captcha:api] captcha_capsolver_processing: AntiCloudflare task ${taskId} has no result yet (status ${tr.status})`,
      );
      markAllProvidersFailed('cloudflare');
      return null;
    }
    const sol = tr.solution ?? {};
    const token = sol.token ?? '';
    const userAgent = sol.userAgent ?? '';
    const cookies =
      sol.cookies && typeof sol.cookies === 'object' ? sol.cookies : {};
    if (!token) {
      console.log('[captcha:api] capsolver AntiCloudflare returned no token');
      markAllProvidersFailed('cloudflare');
      return null;
    }
    console.log(
      `[captcha:solver] Cloudflare solved via capsolver token_chars=${token.length} ua=${userAgent}`,
    );
    costTracker.recordCaptcha('capsolver', 'cloudflare');
    return { token, userAgent, cookies };
  }

  async solveHcaptcha(
    sitekey: string,
    url: string,
    options?: {
      enterprisePayload?: { rqdata: string; rqtoken?: string };
      userAgent?: string;
      proxy?: { server: string; username?: string; password?: string };
    },
  ): Promise<string | null> {
    await this._ensureInit();
    markCaptchaChallenge(); // G8
    const enterprise = !!options?.enterprisePayload;
    const useProxy = !!options?.proxy?.server;
    const baseTask: Record<string, any> = {
      type: useProxy ? 'HCaptchaTask' : 'HCaptchaTaskProxyless',
      websiteURL: url,
      websiteKey: sitekey,
    };
    if (enterprise) {
      baseTask.isEnterprise = true;
      baseTask.enterprisePayload = {
        rqdata: options!.enterprisePayload!.rqdata,
      };
    }
    if (options?.userAgent) baseTask.userAgent = options.userAgent;
    if (useProxy) {
      const u = new URL(options!.proxy!.server);
      // Resolve hostname to IP — captcha services require IP, not hostname
      let ip = u.hostname;
      try {
        const dns = await import('node:dns');
        ip = await new Promise((res, rej) =>
          dns.lookup(u.hostname, (e: any, a: string) => (e ? rej(e) : res(a))),
        );
      } catch {}
      Object.assign(baseTask, {
        proxyType: u.protocol.replace(':', '') || 'http',
        proxyAddress: ip,
        proxyPort: parseInt(u.port, 10),
        proxyLogin: options!.proxy!.username,
        proxyPassword: options!.proxy!.password,
      });
    }
    console.log(
      `[captcha:solver] solveHcaptcha enterprise=${enterprise} proxy=${useProxy} addr=${baseTask.proxyAddress ?? 'none'} sitekey=${sitekey}`,
    );
    // Try all services: anticaptcha → capmonster → capsolver
    if (this._creds.anticaptcha) {
      const token = await apiSolve(
        'https://api.anti-captcha.com',
        this._creds.anticaptcha,
        baseTask,
      );
      if (token) {
        console.log('[captcha:solver] Solved via anticaptcha');
        costTracker.recordCaptcha('anticaptcha', 'hcaptcha');
        return token;
      }
    }
    if (this._creds.capmonster) {
      const token = await apiSolve(
        'https://api.capmonster.cloud',
        this._creds.capmonster,
        baseTask,
      );
      if (token) {
        console.log('[captcha:solver] Solved via capmonster');
        costTracker.recordCaptcha('capmonster', 'hcaptcha');
        return token;
      }
    }
    if (this._creds.capsolver) {
      // CapSolver: HCaptchaEnterpriseTaskProxyLess is its own task type;
      // HCaptchaTaskProxyless + isEnterprise returns ERROR_INVALID_TASK_DATA.
      const t: Record<string, any> = {
        ...baseTask,
        type: enterprise
          ? useProxy
            ? 'HCaptchaEnterpriseTask'
            : 'HCaptchaEnterpriseTaskProxyLess'
          : useProxy
            ? 'HCaptchaTask'
            : 'HCaptchaTaskProxyLess',
      };
      delete t.isEnterprise;
      const token = await apiSolve(
        'https://api.capsolver.com',
        this._creds.capsolver,
        t,
      );
      if (token) {
        console.log('[captcha:solver] Solved via capsolver');
        costTracker.recordCaptcha('capsolver', 'hcaptcha');
        return token;
      }
    }
    console.log('[captcha:solver] All services failed for hCaptcha');
    markAllProvidersFailed('hcaptcha'); // G8
    return null;
  }

  /** PerimeterX cookies; see ./providers/perimeterx.ts. */
  async solvePerimeterX(
    url: string,
    userAgent: string,
    cookies?: Array<{ name: string; value: string; domain?: string }>,
    proxy?: string,
  ): Promise<Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }> | null> {
    await this._ensureInit();
    return solvePerimeterXCookies(this._creds, url, userAgent, cookies, proxy);
  }

  /** A FunCaptcha token; see ./providers/funcaptcha.ts. */
  async solveFuncaptcha(
    publicKey: string,
    url: string,
    subdomain?: string,
    blob?: string,
  ): Promise<string | null> {
    await this._ensureInit();
    return solveFuncaptchaToken(this._creds, publicKey, url, subdomain, blob);
  }
}
