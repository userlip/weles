// Saved browser sessions: each label's cookies, kept where Weles keeps every
// other credential. On a machine running Skarbiec they are one Weles setting
// record in the vault; on a machine without it (WELES_CREDENTIALS_FILE set)
// they are one item of that owner-only credentials file. No file under the
// home directory holds them.

import {
  localCredentialsFile,
  readLocalField,
  writeLocalFields,
} from '../secrets/scoped-service/local-file.js';
import { readSetting, writeSetting } from '../state/skarbiec-records.js';

// ---------------------------------------------------------------------------
// Minimal type interfaces
// ---------------------------------------------------------------------------

export interface SessionContext {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface CookieParam {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  [key: string]: unknown;
}

type Sessions = Record<string, CookieParam[]>;

/** The Skarbiec setting, and the credentials-file item and field, that hold every saved session. */
const SESSIONS_SETTING = 'browser_sessions';
const SESSIONS_ITEM = 'weles-browser-sessions';
const SESSIONS_FIELD = 'sessions_json';

// ---------------------------------------------------------------------------
// SessionStore
// ---------------------------------------------------------------------------

export class SessionStore {
  // -----------------------------------------------------------------------
  // Low-level persistence
  // -----------------------------------------------------------------------

  /** Where the sessions are kept, as a refusal names it. */
  private _where(): string {
    const local = localCredentialsFile();
    return local
      ? `WELES_CREDENTIALS_FILE ${local} item ${SESSIONS_ITEM}`
      : `Skarbiec setting ${SESSIONS_SETTING}`;
  }

  // A store that holds nothing yet holds no sessions. One that holds
  // something other than a map of labels to cookie lists is refused with
  // where it is: answering it as empty made the next save write it back with
  // only one label, dropping every other service's saved session.
  private _readStore(): Sessions {
    const local = localCredentialsFile();
    let saved: unknown;
    if (local) {
      const raw = readLocalField(local, SESSIONS_ITEM, SESSIONS_FIELD);
      if (raw === undefined) return {};
      try {
        saved = JSON.parse(raw);
      } catch (error: unknown) {
        throw new Error(
          `${this._where()} field ${SESSIONS_FIELD} is not JSON: ${String(error)}`,
        );
      }
    } else {
      saved = readSetting<unknown>(SESSIONS_SETTING, {});
    }
    if (
      !saved ||
      typeof saved !== 'object' ||
      Array.isArray(saved) ||
      Object.values(saved).some((cookies) => !Array.isArray(cookies))
    )
      throw new Error(
        `${this._where()} does not map session labels to cookie lists`,
      );
    return saved as Sessions;
  }

  private _writeStore(store: Sessions): void {
    const local = localCredentialsFile();
    if (local)
      writeLocalFields(local, SESSIONS_ITEM, {
        [SESSIONS_FIELD]: JSON.stringify(store),
      });
    else writeSetting(SESSIONS_SETTING, store);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Persist an array of cookies under the given label.
   */
  saveCookies(label: string, cookies: CookieParam[]): void {
    const store = this._readStore();
    store[label] = cookies;
    this._writeStore(store);
  }

  /**
   * Retrieve previously saved cookies, or `null` if the label is unknown.
   */
  loadCookies(label: string): CookieParam[] | null {
    const store = this._readStore();
    return Object.hasOwn(store, label) ? store[label] : null;
  }

  /**
   * Inject stored cookies into a browser context via the CDP
   * `Network.setCookie` command.
   */
  async inject(context: SessionContext, label: string): Promise<void> {
    const cookies = this.loadCookies(label);
    if (!cookies?.length) return;

    for (const cookie of cookies) {
      await context.send('Network.setCookie', cookie);
    }
  }

  /**
   * Extract all cookies from a browser context and persist them under the
   * given label. An answer without a cookies list is refused by name: saved
   * as empty it would log the account out of every later run.
   */
  async capture(context: SessionContext, label: string): Promise<void> {
    const result = await context.send('Network.getAllCookies');
    const cookies =
      result && typeof result === 'object' && 'cookies' in result
        ? result.cookies
        : undefined;
    if (!Array.isArray(cookies)) {
      throw new Error(
        `Network.getAllCookies answered no cookies list for session ${label}; the saved session is kept: ${JSON.stringify(result)}`,
      );
    }
    this.saveCookies(label, cookies);
  }

  /**
   * Inject stored cookies into a Playwright BrowserContext (uses the
   * addCookies API). Playwright sets a cookie from its name and value
   * strings and its domain; a stored cookie without them is refused by name
   * rather than dropped, since a session missing one of its cookies signs in
   * as nobody without saying so. Answers whether any cookie was injected.
   */
  async injectPlaywright(
    context: { addCookies(cookies: CookieParam[]): Promise<void> },
    label: string,
  ): Promise<boolean> {
    const cookies = this.loadCookies(label);
    if (!cookies?.length) return false;
    const incomplete = cookies.filter(
      (c) =>
        typeof c.name !== 'string' || typeof c.value !== 'string' || !c.domain,
    );
    if (incomplete.length) {
      throw new Error(
        `session ${label} in ${this._where()} holds cookies without a name, value or domain, which Playwright cannot set: ${incomplete.map((c) => JSON.stringify({ name: c.name, domain: c.domain })).join(', ')}`,
      );
    }
    await context.addCookies(cookies);
    return true;
  }

  /**
   * Capture cookies from a Playwright BrowserContext and persist them.
   * Playwright's cookies carry a name, value and domain each, the fields a
   * saved cookie needs; their interface is read as the stored shape.
   */
  async capturePlaywright(
    context: { cookies(): Promise<unknown[]> },
    label: string,
  ): Promise<CookieParam[]> {
    const cookies = (await context.cookies()) as CookieParam[];
    this.saveCookies(label, cookies);
    return cookies;
  }
}
