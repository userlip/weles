/**
 * Declarative Task runner: FetchAccountValue says which account, where to
 * start and what to read; the runner owns the browser, the saved session,
 * the login and the discovery of the value.
 *
 * Every input that decides the run (the browser's operating system, the
 * proxy, where learned routes are kept) is stated by the caller. A failure to
 * read or write the saved session or a learned route is thrown with its path
 * and cause: an unreadable store answered as "nothing saved" made the next run
 * log in afresh or rediscover the route with nothing saying why.
 */

import type { Page } from 'playwright';
import * as discover from './discover.js';
import * as login from './login.js';
import * as vision from './vision.js';
import { Trajectory } from './trajectory-cache.js';
import { waitCloudflare } from '../../cloudflare/challenge.js';
import { SessionStore } from '../../session/store.js';
import type { AsyncNewBrowserOptions } from '../../async_api.js';
import {
  readOptionalWelesServiceSecret,
  type WelesServiceSecret,
} from '../../secrets/scoped-service.js';

export interface FetchAccountValueConfig {
  service: string;
  url: string;
  what: string;
  secretService: WelesServiceSecret;
  /** The operating system the browser presents. */
  osTarget: string;
  /** The directory learned routes are kept in. */
  trajectoryCacheDir: string;
  /** The proxy the browser goes out through; absent means a direct connection. */
  proxy?: AsyncNewBrowserOptions['proxy'];
}

type StatedField =
  | 'service'
  | 'url'
  | 'what'
  | 'osTarget'
  | 'trajectoryCacheDir';

function stated(config: FetchAccountValueConfig, name: StatedField): string {
  const value = config[name];
  if (typeof value !== 'string' || !value.trim())
    throw new Error(
      `FetchAccountValue needs ${name}: it is stated by the caller, never assumed`,
    );
  return value;
}

/** A number shown on the page, read from the element's own text. */
function shownNumber(text: string): number | null {
  const digits = text.replace(/[^\d.-]/g, '');
  if (!digits) return null;
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  return value;
}

/** A selector the model named, without the quotes it may wrap it in. */
function namedSelector(answer: string | null): string | null {
  if (answer === null) return null;
  const selector = answer.trim().replace(/^[`'"]+|[`'"]+$/g, '');
  if (!selector) return null;
  return selector;
}

export class FetchAccountValue {
  service: string;
  url: string;
  what: string;
  secretService: WelesServiceSecret;
  osTarget: string;
  trajectoryCacheDir: string;
  proxy: AsyncNewBrowserOptions['proxy'];

  constructor(config: FetchAccountValueConfig) {
    this.service = stated(config, 'service');
    this.url = stated(config, 'url');
    this.what = stated(config, 'what');
    this.osTarget = stated(config, 'osTarget');
    this.trajectoryCacheDir = stated(config, 'trajectoryCacheDir');
    this.secretService = config.secretService;
    this.proxy = config.proxy;
  }

  async run(): Promise<number | null> {
    const traj = Trajectory.load(this.trajectoryCacheDir, this.service);
    if (traj) {
      const replayValue = await this._replayTrajectory(traj);
      if (replayValue !== null) {
        console.log(
          `[task] ${this.service}: cache replay hit, value=${replayValue}`,
        );
        traj.lastValue = replayValue;
        traj.lastSuccess = new Date().toISOString();
        traj.save(this.trajectoryCacheDir);
        return replayValue;
      }
      console.log(`[task] ${this.service}: cache replay missed, invalidating`);
      Trajectory.invalidate(this.trajectoryCacheDir, this.service);
    }

    const value = await this._attemptWithExistingSession();
    if (value !== null) return value;
    console.log(
      `[task] ${this.service}: first attempt found no value, clearing the saved session`,
    );
    new SessionStore().saveCookies(this.service, []);
    return this._attemptWithExistingSession();
  }

  private async _openPage(): Promise<Page> {
    const { AsyncNewBrowser } = await import('../../async_api.js');
    const context = await AsyncNewBrowser({
      os: this.osTarget,
      browser: 'chromium',
      headless: false,
      proxy: this.proxy,
    });
    await new SessionStore().injectPlaywright(context, this.service);
    const [opened] = context.pages();
    if (opened) return opened;
    return context.newPage();
  }

  private async _closePage(page: Page): Promise<void> {
    await page
      .context()
      .close()
      .catch((cause: unknown) => {
        console.log(
          `[task] ${this.service}: browser session close failed: ${String(cause)}`,
        );
      });
  }

  private async _replayTrajectory(traj: Trajectory): Promise<number | null> {
    const page = await this._openPage();
    try {
      await page.goto(traj.finalUrl, { waitUntil: 'domcontentloaded' });
      await waitCloudflare(page);
      if (await this._isLoginPage(page)) return null;
      const element = await page.$(traj.selector);
      if (!element) return null;
      return shownNumber((await element.innerText()).trim());
    } finally {
      await this._closePage(page);
    }
  }

  private async _attemptWithExistingSession(): Promise<number | null> {
    const page = await this._openPage();
    try {
      await page.goto(this.url, { waitUntil: 'domcontentloaded' });
      await waitCloudflare(page);
      if (await this._isLoginPage(page)) await this._loginInline(page);
      const value = await discover.findNumber(page, this.what);
      if (value !== null) await this._learnTrajectory(page, value);
      return value;
    } finally {
      await this._closePage(page);
    }
  }

  private async _isLoginPage(page: Page): Promise<boolean> {
    return vision.boolean(
      page,
      'Is this page showing a login form with username and ' +
        'password fields, or a "Sign in" / "Log in" button as ' +
        'the main call to action?',
    );
  }

  private async _loginInline(page: Page): Promise<void> {
    const username = readOptionalWelesServiceSecret(
      this.secretService,
      'username',
    );
    const password = readOptionalWelesServiceSecret(
      this.secretService,
      'password',
    );
    if (!username || !password) {
      const missing = [
        username ? [] : ['username'],
        password ? [] : ['password'],
      ].flat();
      throw new Error(
        `${this.service} shows a login page and ${this.secretService} grants no ${missing.join(' or ')}`,
      );
    }
    if (!(await login.run(page, username, password)))
      throw new Error(
        `${this.service}: login with ${this.secretService} did not reach the account at ${page.url()}`,
      );
    await new SessionStore().capturePlaywright(page.context(), this.service);
  }

  // The value is already read; a route that cannot be learned only costs the
  // next run a rediscovery, so it is said and the value is still returned.
  private async _learnTrajectory(page: Page, value: number): Promise<void> {
    try {
      const selector = namedSelector(
        await vision.text(
          page,
          `a CSS selector that uniquely identifies the element containing ${this.what}`,
        ),
      );
      if (selector === null) {
        console.log(
          `[task] ${this.service}: no selector named for ${this.what} at ${page.url()}; route not learned`,
        );
        return;
      }
      new Trajectory({
        service: this.service,
        finalUrl: page.url(),
        selector,
        lastSuccess: new Date().toISOString(),
        lastValue: value,
      }).save(this.trajectoryCacheDir);
      console.log(
        `[task] ${this.service}: trajectory cached (url=${page.url()}, selector=${JSON.stringify(selector)})`,
      );
    } catch (cause) {
      console.log(
        `[task] ${this.service}: could not learn trajectory: ${String(cause)}`,
      );
    }
  }
}
