// Cross-platform OAuth helpers.
//
// Pattern: use stored cookies from an account on platform A to OAuth-sign-in
// to platform B (e.g. Twitter account -> ProductHunt, Instagram account ->
// Threads): cookie domain normalization, the wait for the provider to hand
// the page back, and the reCAPTCHA-gate submit. The consent screen between
// them is answered by the trajectories' judged page reading
// (src/trajectories/_shared/oauth/consent.mjs).

import { pageSettled } from '../../browser/settled.js';
import { solvePageCaptcha } from '../../captcha/detect.js';

type BrowserCtx = any;
type PageLike = any;
type SessionLike = any;

interface ProviderConfig {
  primaryDomain: string;
  mirrorDomains: string[];
}

const PROVIDER_DOMAINS: Record<string, ProviderConfig> = {
  twitter: { primaryDomain: '.x.com', mirrorDomains: ['.twitter.com'] },
  instagram: { primaryDomain: '.instagram.com', mirrorDomains: [] },
  google: {
    primaryDomain: '.google.com',
    mirrorDomains: ['.youtube.com', '.accounts.google.com'],
  },
  facebook: {
    primaryDomain: '.facebook.com',
    mirrorDomains: ['.messenger.com'],
  },
  github: { primaryDomain: '.github.com', mirrorDomains: [] },
  apple: { primaryDomain: '.apple.com', mirrorDomains: ['.icloud.com'] },
  microsoft: {
    primaryDomain: '.microsoftonline.com',
    mirrorDomains: ['.live.com', '.microsoft.com', '.login.microsoft.com'],
  },
};

/** A cookie as the browser context reported it when the account was saved. */
export interface RawCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expires: number;
}

/** The fields a saved cookie must carry to be set again in a browser. */
const COOKIE_FIELDS: Record<keyof RawCookie, string> = {
  name: 'string',
  value: 'string',
  domain: 'string',
  path: 'string',
  secure: 'boolean',
  httpOnly: 'boolean',
  sameSite: 'string',
  expires: 'number',
};

/** The cookie row, refused by name when it lacks a field the browser needs. */
function savedCookie(provider: string, row: unknown, index: number): RawCookie {
  const record = row as Record<string, unknown>;
  for (const [field, type] of Object.entries(COOKIE_FIELDS)) {
    if (typeof record[field] !== type)
      throw new Error(
        `oauth_cookie_unusable: ${provider} cookie row ${index} holds no ${type} ${field}; an account's cookies are saved from the browser context, so this row was written by something else and the account must be signed in again`,
      );
  }
  return record as unknown as RawCookie;
}

/**
 * Add the provider account's saved cookies to the browser context, on the
 * provider's own domains and on `extraMirrorDomains` (a sibling site that
 * accepts the same session, e.g. '.threads.net' for an Instagram account).
 * Returns the count added.
 */
export async function injectProviderCookies(
  ctx: BrowserCtx,
  provider: string,
  cookies: unknown[],
  extraMirrorDomains: string[],
): Promise<number> {
  if (!Object.hasOwn(PROVIDER_DOMAINS, provider))
    throw new Error(
      `unknown_oauth_provider: ${provider} has no declared cookie domains; declare them in PROVIDER_DOMAINS`,
    );
  const { primaryDomain, mirrorDomains } = PROVIDER_DOMAINS[provider];
  const saved = cookies.map((row, index) => savedCookie(provider, row, index));
  const bare = (domain: string) => domain.replace(/^\./, '');
  const all = [...saved];
  for (const mirror of [...mirrorDomains, ...extraMirrorDomains])
    all.push(
      ...saved.map((c) => ({
        ...c,
        domain: c.domain.replace(bare(primaryDomain), bare(mirror)),
      })),
    );
  await ctx.addCookies(all);
  return all.length;
}

/** Whether `url` is on `host` itself or one of its subdomains. */
export function onHost(host: string): (url: URL) => boolean {
  return (url) => `.${url.hostname}`.endsWith(`.${host}`);
}

/**
 * Wait until the provider hands the page back: `arrived` reads the page's
 * address and answers whether it is the caller's own site again. A page on a
 * provider's host never is, whatever its query names, so no provider has to
 * be listed.
 */
export async function waitForNavBackTo(
  page: PageLike,
  arrived: (url: URL) => boolean,
): Promise<void> {
  await page.waitForURL(arrived);
}

/**
 * Clear a reCAPTCHA v2 gate page. Detects captcha via src/captcha/detect.ts,
 * solves the token, then submits the form that holds the token the way its
 * own submit control would (form.requestSubmit runs the page's onSubmit,
 * which an SPA gate needs to run its mutation). A page that stays on the gate
 * is navigated to `homeUrl` once: the gate's answer is a server cookie, and
 * the next request carries it.
 */
export async function clearReCaptchaGate(
  s: SessionLike,
  solver: any,
  gateUrlSubstring: string,
  homeUrl: string,
): Promise<boolean> {
  const onGate = () => s.page.url().includes(gateUrlSubstring);
  // One solve: a second token on the same gate is the same answer to a page
  // that already refused it.
  if (!onGate()) return true;
  await s.page.waitForSelector('iframe[src*="recaptcha/api2/anchor"]');
  await pageSettled(s.page);
  if (!(await solvePageCaptcha(s.page, solver, s))) return false;
  const unsent = await s.page.evaluate(() => {
    const token = document.getElementById(
      'g-recaptcha-response',
    ) as HTMLTextAreaElement | null;
    if (!token) return 'the page holds no g-recaptcha-response field';
    if (!token.value) return 'the solved token was not written to the page';
    if (!token.form) return 'the token field belongs to no form';
    token.form.requestSubmit();
    return null;
  });
  if (unsent)
    throw new Error(`recaptcha_gate_unsubmitted: ${unsent} at ${s.page.url()}`);
  await pageSettled(s.page);
  if (!onGate()) return true;
  await s.page.goto(homeUrl);
  await pageSettled(s.page);
  if (!onGate()) return true;
  console.log(`[oauth] recaptcha_gate_not_cleared: still on ${s.page.url()}`);
  return false;
}
