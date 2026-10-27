/**
 * PerimeterX (HUMAN Security) — used by LinkedIn checkpointV2 / NewYorkTimes /
 * Zillow. Solved through CapSolver's AntiPerimeterx task when its key is held,
 * then through nocaptcha.io wanda/perimeterx/universal, either of which returns
 * the _px3/_pxde/pxcts cookies that satisfy the challenge. The keys are
 * acquired from their exact Skarbiec items. Returns Playwright-shaped cookies
 * ready for ctx.addCookies(); the caller then re-navigates and proceeds.
 */

import { costTracker } from '../../utils/runtime/cost.js';
import { markAllProvidersFailed, markCaptchaChallenge } from '../events.js';
import {
  providerJson,
  readUntilSolved,
  type CaptchaCredentials,
} from './api.js';

type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The page's cookies by name, as both services take them.
function cookieMap(
  cookies?: Array<{ name: string; value: string; domain?: string }>,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (cookies)
    for (const c of cookies) if (c?.name && c?.value) map[c.name] = c.value;
  return map;
}

// The cookies a service answered, scoped to the page's registrable domain;
// an answer that holds no cookie object is named by the caller.
function playwrightCookies(
  answered: unknown,
  domain: string,
): PlaywrightCookie[] | null {
  if (!answered || typeof answered !== 'object') return null;
  return Object.entries(answered).map(([name, value]) => ({
    name,
    value: String(value),
    domain,
    path: '/',
  }));
}

export async function solvePerimeterXCookies(
  creds: CaptchaCredentials,
  url: string,
  userAgent: string,
  cookies?: Array<{ name: string; value: string; domain?: string }>,
  proxy?: string,
): Promise<PlaywrightCookie[] | null> {
  markCaptchaChallenge(); // G8
  const u = new URL(url);
  const domain = '.' + u.hostname.replace(/^www\./, '');
  if (creds.capsolver) {
    const task: Record<string, unknown> = {
      type: proxy ? 'AntiPerimeterxTask' : 'AntiPerimeterxTaskProxyLess',
      websiteURL: url,
      userAgent,
    };
    const pageCookies = cookieMap(cookies);
    if (Object.keys(pageCookies).length) task.cookies = pageCookies;
    if (proxy) {
      const pp = new URL(proxy);
      task.proxyType = pp.protocol.replace(':', '');
      task.proxyAddress = pp.hostname;
      task.proxyPort = Number(pp.port);
      if (pp.username) task.proxyLogin = decodeURIComponent(pp.username);
      if (pp.password) task.proxyPassword = decodeURIComponent(pp.password);
    }
    console.log(
      `[captcha:api] capsolver AntiPerimeterx createTask type=${task.type} url=${url}`,
    );
    try {
      const cr = await providerJson(
        await fetch('https://api.capsolver.com/createTask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientKey: creds.capsolver, task }),
        }),
        'capsolver AntiPerimeterx createTask',
      );
      if (cr.errorId)
        console.log(
          `[captcha:api] capsolver AntiPerimeterx createTask err: ${cr.errorCode} ${cr.errorDescription}`,
        );
      else if (!cr.taskId)
        console.log(
          `[captcha:api] capsolver AntiPerimeterx createTask answered no taskId: ${JSON.stringify(cr)}`,
        );
      else {
        const tr = await readUntilSolved(
          async () =>
            providerJson(
              await fetch('https://api.capsolver.com/getTaskResult', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  clientKey: creds.capsolver,
                  taskId: cr.taskId,
                }),
              }),
              `capsolver getTaskResult for AntiPerimeterx task ${cr.taskId}`,
            ),
          (answer) => !answer.errorId && answer.status === 'processing',
        );
        if (tr.errorId)
          console.log(
            `[captcha:api] capsolver AntiPerimeterx err: ${tr.errorCode} ${tr.errorDescription}`,
          );
        else if (tr.status !== 'ready')
          console.log(
            `[captcha:api] capsolver AntiPerimeterx task ${cr.taskId} answered status ${tr.status}, neither processing nor ready: ${JSON.stringify(tr)}`,
          );
        else {
          const out = playwrightCookies(tr.solution?.cookies, domain);
          if (out?.length) {
            console.log(
              `[captcha:solver] PerimeterX solved via capsolver (${out.length} cookies)`,
            );
            costTracker.recordCaptcha('capsolver', 'perimeterx');
            return out;
          }
          console.log(
            `[captcha:api] capsolver AntiPerimeterx task ${cr.taskId} is ready but its solution carries no cookies: ${JSON.stringify(tr.solution)}`,
          );
        }
      }
    } catch (error: unknown) {
      console.log(
        `[captcha:api] capsolver AntiPerimeterx fetch err: ${message(error)}; trying nocaptcha`,
      );
    }
  }
  const token = creds.nocaptcha;
  if (!token) {
    console.log(
      '[captcha:solver] PerimeterX: no NOCAPTCHA_API_KEY (capsolver path returned no cookies)',
    );
    markAllProvidersFailed('perimeterx');
    return null;
  } // G8
  const body: Record<string, unknown> = {
    href: url,
    user_agent: userAgent,
    cookies: cookieMap(cookies),
  };
  if (proxy) {
    const p = new URL(proxy);
    body.proxy = p.username
      ? `${p.username}:${p.password}@${p.hostname}:${p.port}`
      : `${p.hostname}:${p.port}`;
  }
  console.log(
    `[captcha:api] nocaptcha PerimeterX solve href=${url} proxy=${!!proxy}`,
  );
  let j;
  try {
    j = await providerJson(
      await fetch('http://api.nocaptcha.io/api/wanda/perimeterx/universal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Token': token },
        body: JSON.stringify(body),
      }),
      'nocaptcha PerimeterX solve',
    );
  } catch (error: unknown) {
    markAllProvidersFailed('perimeterx');
    throw new Error(
      `PerimeterX could not be solved: nocaptcha did not answer: ${message(error)}`,
      { cause: error },
    );
  }
  // nocaptcha answers status 1 for a solve and 0 for a refusal.
  if (!j?.status) {
    console.log(
      `[captcha:api] nocaptcha PerimeterX err status=${j?.status} msg=${j?.msg ?? j?.message ?? JSON.stringify(j)}`,
    );
    markAllProvidersFailed('perimeterx');
    return null;
  } // G8
  const out = playwrightCookies(j.data?.cookies, domain);
  if (!out?.length) {
    console.log(
      `[captcha:api] nocaptcha PerimeterX solved but its answer carries no cookies: ${JSON.stringify(j.data)}`,
    );
    return null;
  }
  console.log(
    `[captcha:solver] PerimeterX solved via nocaptcha (${out.length} cookies)`,
  );
  costTracker.recordCaptcha('nocaptcha', 'perimeterx');
  return out;
}
