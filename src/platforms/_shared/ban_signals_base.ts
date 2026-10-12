/**
 * Shared base for per-platform ban-signal detectors.
 *
 * Each platform supplies the structure it is known by: the routes its site
 * redirects a blocked or signed-out session to, the API answers whose fields
 * say the account is challenged, and the API endpoints whose failure is
 * suspicious. What the page itself says about the account is judged by the
 * vision model through Brama against the states below, in any language and
 * wording, instead of lists of phrases. The engine runs URL → page judgement
 * → response answers and returns the first state that is not healthy. Same
 * BanSignal shape as the Reddit-specific detector at
 * src/platforms/reddit/ban_signals.ts so callers (worker pool, action_log
 * writer) handle every platform identically.
 */
import type { Page } from 'playwright';
import { askPage, type ScreenshottablePage } from '../../vision/analyze.js';
import declaredSignals from './signals.json';

export type BanSignalKind =
  | 'healthy'
  | 'suspended'
  | 'rate_limited'
  | 'captcha_challenge'
  | 'checkpoint'
  | 'shadowban_suspected'
  | 'unknown_error'
  | 'proxy_failed'
  | 'proxy_auth_failed'
  | 'ip_blocked'
  | 'insufficient_credits';

export interface BanSignal {
  healthy: boolean;
  signal: BanSignalKind;
  details: Record<string, unknown>;
}

/** A response the session observed, as the detectors are handed it. */
export interface ObservedResponse {
  url: string;
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

/** One platform's structure as signals.json declares it, compiled. */
interface PlatformSignals {
  routes: Array<{ signal: BanSignalKind; route: RegExp }>;
  apiAnswers: Array<{
    signal: BanSignalKind;
    endpoint: RegExp;
    answer: RegExp;
  }>;
  suspiciousApiEndpoints: RegExp;
}

const matching = (source: string) => new RegExp(source, 'i');

const PLATFORM_SIGNALS: Readonly<Record<string, PlatformSignals>> =
  Object.fromEntries(
    Object.entries(declaredSignals.platforms).map(([platform, declared]) => [
      platform,
      {
        routes: Object.entries(
          declared.routes as Record<string, string[]>,
        ).flatMap(([signal, routes]) =>
          routes.map((route) => ({
            signal: signal as BanSignalKind,
            route: matching(route),
          })),
        ),
        apiAnswers: (declared.apiAnswers as Array<Record<string, string>>).map(
          (rule) => ({
            signal: rule.signal as BanSignalKind,
            endpoint: matching(rule.endpoint),
            answer: matching(rule.answer),
          }),
        ),
        suspiciousApiEndpoints: matching(declared.suspiciousEndpoints),
      },
    ]),
  );

/**
 * The states a page can show about the account, each as the model is asked
 * to recognise it. The proxy states are read from Chrome's own error page
 * and a shadowban is never shown, so neither is judged here.
 */
const PAGE_STATES: Readonly<Partial<Record<BanSignalKind, string>>> = {
  healthy: 'the site is used normally by the signed-in account',
  suspended:
    'the site says the account is suspended, disabled, banned, restricted or no longer exists',
  rate_limited:
    'the site says the account or this visitor is doing too much and has to wait',
  captcha_challenge:
    'the page asks to solve a captcha or otherwise prove the visitor is human',
  checkpoint:
    'the site asks to sign in again, confirm identity or enter a code before continuing',
  insufficient_credits:
    'the site says the account has no credits or quota left for this use',
  ip_blocked:
    'the site blocks this network or IP address rather than the account',
};

/**
 * The state the model judges the page to show. A question the model could
 * not answer, or an answer that names no state, is unknown_error with the
 * cause: a page is never called healthy for want of a judgement.
 */
async function judgedPageSignal(
  page: Page,
  details: Record<string, unknown>,
): Promise<BanSignal> {
  const states = Object.entries(PAGE_STATES)
    .map(([state, meaning]) => `${state} (${meaning})`)
    .join('; ');
  let answer: string;
  try {
    answer = (
      await askPage(
        page as unknown as ScreenshottablePage,
        `Which one of these states does this page show about the account? ${states}. Answer with the state's name only.`,
      )
    ).trim();
  } catch (error) {
    return {
      healthy: false,
      signal: 'unknown_error',
      details: {
        ...details,
        judgement_error: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (!Object.hasOwn(PAGE_STATES, answer)) {
    return {
      healthy: false,
      signal: 'unknown_error',
      details: {
        ...details,
        judgement_error: `the vision model answered ${JSON.stringify(answer)}, which names no state`,
      },
    };
  }
  const signal = answer as BanSignalKind;
  return {
    healthy: signal === 'healthy',
    signal,
    details: { ...details, judged_state: signal },
  };
}

/**
 * The signal of a Chrome error page (the proxy CONNECT or DNS failed), read
 * from its text: 407 or proxy auth is proxy_auth_failed, an HTTP 4xx is
 * ip_blocked, anything else proxy_failed. A text that could not be read is
 * recorded with its cause, so a proxy_failed reached without any text says
 * so.
 */
export async function chromeErrorSignal(
  page: Page,
  details: Record<string, unknown>,
): Promise<BanSignal> {
  let chromeBody = '';
  try {
    chromeBody = await page.evaluate(() =>
      document.body === null ? '' : document.body.innerText,
    );
  } catch (error) {
    details.body_text_error =
      error instanceof Error ? error.message : String(error);
  }
  details.body_text_sample = chromeBody;
  const signal: BanSignalKind = /HTTP ERROR 407|ERR_PROXY_AUTH/i.test(
    chromeBody,
  )
    ? 'proxy_auth_failed'
    : /HTTP ERROR 4|ERR_HTTP_RESPONSE_CODE/i.test(chromeBody)
      ? 'ip_blocked'
      : 'proxy_failed';
  return { healthy: false, signal, details };
}

/**
 * The account state of `platform`'s run: its Chrome error page, the route
 * the site sent the session to, the model's judgement of the page, then the
 * API answers the session observed. A platform signals.json does not declare
 * is refused by name.
 */
export async function detectDeclared(
  platform: string,
  page: Page,
  responses: ObservedResponse[] | undefined,
): Promise<BanSignal> {
  if (!Object.hasOwn(PLATFORM_SIGNALS, platform))
    throw new Error(
      `no account signals are declared for ${platform} in src/platforms/_shared/signals.json`,
    );
  const cfg = PLATFORM_SIGNALS[platform];
  const observed: ObservedResponse[] = [];
  if (responses) observed.push(...responses);
  const details: Record<string, unknown> = {};
  const url = page.url();
  details.final_url = url;

  // 0. Chrome error page — proxy CONNECT or DNS failed. The page renders
  //    chromium's system error rather than the requested URL. Classify by
  //    body content: 407/Proxy Auth → proxy_auth_failed; HTTP 4xx → ip_blocked;
  //    ERR_TUNNEL/timeout → proxy_failed. Without this branch every detector
  //    returned 'healthy' on these pages because no platform-ban keywords
  //    appear, masking proxy-side failures fleet-wide (a provider
  //    traffic-limit outage reads as hours of misdiagnosis this way).
  if (url.startsWith('chrome-error://'))
    return chromeErrorSignal(page, details);

  // 1. The route the site sent the session to.
  for (const { signal, route } of cfg.routes) {
    if (route.test(url))
      return {
        healthy: false,
        signal,
        details: { ...details, matched_url: route.source },
      };
  }

  // 2. The page itself. A page whose text cannot be read, or that has no
  //    body, is not called healthy: the failed read is the verdict, with its
  //    cause. A readable page is judged by the model.
  let bodyText: string | null;
  try {
    bodyText = await page.evaluate(() =>
      document.body === null ? null : document.body.innerText,
    );
  } catch (error) {
    bodyText = null;
    details.body_text_error =
      error instanceof Error ? error.message : String(error);
  }
  if (bodyText === null) {
    if (details.body_text_error === undefined)
      details.body_text_error = 'the page has no body to read';
    return { healthy: false, signal: 'unknown_error', details };
  }
  details.body_text_sample = bodyText;
  const judged = await judgedPageSignal(page, details);
  if (!judged.healthy) return judged;
  details.judged_state = judged.signal;

  // 3. Response bodies + 429 detection
  for (const r of observed) {
    if (r.status === 429) {
      return {
        healthy: false,
        signal: 'rate_limited',
        details: {
          ...details,
          rate_limited_url: r.url,
          retry_after: r.headers?.['retry-after'],
        },
      };
    }
    if (!r.body) continue;
    for (const rule of cfg.apiAnswers) {
      if (rule.endpoint.test(r.url) && rule.answer.test(r.body)) {
        return {
          healthy: false,
          signal: rule.signal,
          details: { ...details, matched_url: r.url },
        };
      }
    }
  }

  // 4. Suspicious-but-unclassified API failure
  if (cfg.suspiciousApiEndpoints) {
    const sus = observed.find(
      (r) => r.status >= 400 && cfg.suspiciousApiEndpoints!.test(r.url),
    );
    if (sus)
      return {
        healthy: false,
        signal: 'unknown_error',
        details: { ...details, suspicious_url: sus.url, status: sus.status },
      };
  }

  return { healthy: true, signal: 'healthy', details };
}
