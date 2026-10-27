/**
 * What a caller asks WSession for, and how that request is named on disk and
 * in the run log: the option shape every trajectory passes to WSession.start,
 * the redaction used when the request is logged, the country a pool-style
 * proxy request names, and the per-account browser-profile directory the
 * request resolves to. WSessionOptions is re-exported by name from
 * ../wsession.ts, so its import path is the same for every consumer.
 */

import { chmodSync, constants, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import type { AsyncNewBrowserOptions } from '../../async_api.js';
import type { Persona } from '../../browser/persona.js';

/** The realized proxy a launched session presents, as async_api takes it. */
export type SessionProxy = NonNullable<AsyncNewBrowserOptions['proxy']>;

/** The proxy a running session went through, as it reports it. */
export type SessionProxyConfig = {
  server: string;
  username?: string;
  password?: string;
  country?: string;
  exit_ip?: string;
  platform?: string;
};

/** One response the session kept, with its body as text. */
export type CapturedResponse = {
  ts: number;
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export interface WSessionOptions {
  label?: string;
  proxy?: string;
  userDataDir?: string;
  headless?: boolean;
  record?: boolean;
  operatorCdp?: boolean;
  targetHost?: string;
  os?: string;
  locale?: string;
  persona?: Persona;
  browser?: string;
  pageDiagnostics?: boolean;
  userAgent?: string;
  // When set, WSession.start auto-invokes generateIdentity(platform) and
  // attaches the result to ws.identity. Register trajectories should pass
  // their platform here instead of importing generateIdentity themselves.
  platform?: string;
}

/** A browser profile is the owner's alone. */
const OWNER_ONLY = constants.S_IRWXU;

/**
 * The proxy as the run log shows it: a proxy URL with its password masked
 * (the username is logged whole, as the object form logs it), a pool request
 * ("residential oxylabs us") as written, since it carries no secret, and a
 * proxy setting with its password masked.
 */
export function redactProxyForLog(proxy: unknown): string {
  if (!proxy) return 'no proxy';
  if (typeof proxy === 'string') {
    if (!URL.canParse(proxy)) return proxy;
    const u = new URL(proxy);
    if (u.password) u.password = '***';
    return u.toString();
  }
  if (typeof proxy === 'object') {
    const p = proxy as {
      server?: string;
      username?: string;
      password?: string;
    };
    return JSON.stringify({
      server: p.server,
      username: p.username,
      password: p.password ? '***' : undefined,
    });
  }
  return String(proxy);
}

/** The platform an account's browser profiles are filed under: the request's, else the action's first word, else the target host. */
function profilePlatform(opts: WSessionOptions): string {
  const action = process.env.ACTION?.trim();
  const [actionPlatform] = action ? action.split('_') : [];
  const named = [
    opts.platform?.trim(),
    actionPlatform,
    opts.targetHost?.trim(),
  ].find(Boolean);
  if (!named)
    throw new Error(
      'ACCOUNT_PROFILE_PLATFORM_UNNAMED: an account session needs its platform (WSession.start platform, the ACTION it runs, or targetHost) to file its browser profile under',
    );
  return named;
}

/**
 * The browser profile directory this request owns: one directory per account,
 * keyed by a hash of ACCOUNT_ID under <platform>/<browser>. Undefined when the
 * run has no ACCOUNT_ID, which is how a session gets an ephemeral profile.
 */
export function accountProfileDirectory(
  opts: WSessionOptions,
  browser: string,
): string | undefined {
  const accountId = process.env.ACCOUNT_ID?.trim();
  if (!accountId) return undefined;
  const safePlatform = profilePlatform(opts)
    .toLowerCase()
    .replace(/[^\w.-]+/g, '-');
  const safeBrowser = browser.toLowerCase().replace(/[^\w.-]+/g, '-');
  const accountKey = createHash('sha256').update(accountId).digest('hex');
  const declaredRoot = process.env.WELES_BROWSER_PROFILE_ROOT?.trim();
  const root = declaredRoot
    ? declaredRoot
    : join(userInfo().homedir, '.local', 'state', 'weles', 'browser-profiles');
  const parent = join(root, safePlatform, safeBrowser);
  const directory = join(parent, accountKey);
  mkdirSync(parent, { recursive: true, mode: OWNER_ONLY });
  if (process.env.WELES_FRESH_PROFILE === '1') {
    try {
      mkdirSync(directory, { mode: OWNER_ONLY });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST')
        throw new Error('fresh browser profile directory already exists');
      throw error;
    }
  } else {
    mkdirSync(directory, { recursive: true, mode: OWNER_ONLY });
  }
  chmodSync(directory, OWNER_ONLY);
  return directory;
}
