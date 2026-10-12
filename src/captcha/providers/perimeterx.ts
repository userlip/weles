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
import type { CaptchaCredentials } from './api.js';

export async function solvePerimeterXCookies(
  creds: CaptchaCredentials,
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
  markCaptchaChallenge(); // G8
  const u = new URL(url);
  const dotDom = u.hostname.startsWith('www.')
    ? u.hostname.slice(3)
    : '.' + u.hostname;
  if (creds.capsolver) {
    const cookieMapCs: Record<string, string> = {};
    for (const c of cookies ?? [])
      if (c?.name && c?.value) cookieMapCs[c.name] = c.value;
    const task: Record<string, any> = {
      type: proxy ? 'AntiPerimeterxTask' : 'AntiPerimeterxTaskProxyLess',
      websiteURL: url,
      userAgent,
    };
    if (Object.keys(cookieMapCs).length) task.cookies = cookieMapCs;
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
      const cr = (await (
        await fetch('https://api.capsolver.com/createTask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientKey: creds.capsolver, task }),
        })
      ).json()) as any;
      if (cr.errorId)
        console.log(
          `[captcha:api] capsolver AntiPerimeterx createTask err: ${cr.errorCode} ${cr.errorDescription}`,
        );
      else if (cr.taskId) {
        // One read: CapSolver has no push or blocking answer.
        const tr = (await (
          await fetch('https://api.capsolver.com/getTaskResult', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              clientKey: creds.capsolver,
              taskId: cr.taskId,
            }),
          })
        ).json()) as any;
        if (tr.errorId)
          console.log(
            `[captcha:api] capsolver AntiPerimeterx err: ${tr.errorCode} ${tr.errorDescription}`,
          );
        else if (tr.status !== 'ready')
          console.log(
            `[captcha:api] captcha_capsolver_processing: AntiPerimeterx task ${cr.taskId} has no result yet (status ${tr.status})`,
          );
        else {
          const sol = tr.solution ?? {};
          const cm: Record<string, unknown> =
            sol.cookies && typeof sol.cookies === 'object' ? sol.cookies : {};
          const out: Array<{
            name: string;
            value: string;
            domain: string;
            path: string;
          }> = [];
          for (const [n, v] of Object.entries(cm))
            out.push({
              name: n,
              value: String(v),
              domain: dotDom,
              path: '/',
            });
          if (out.length) {
            console.log(
              `[captcha:solver] PerimeterX solved via capsolver (${out.length} cookies)`,
            );
            costTracker.recordCaptcha('capsolver', 'perimeterx');
            return out;
          }
          console.log(
            '[captcha:api] capsolver AntiPerimeterx returned no cookies in solution',
          );
        }
      }
    } catch (e: any) {
      console.log(
        `[captcha:api] capsolver AntiPerimeterx fetch err: ${e.message}`,
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
  const cookieMap: Record<string, string> = {};
  for (const c of cookies ?? [])
    if (c?.name && c?.value) cookieMap[c.name] = c.value;
  const body: Record<string, any> = {
    href: url,
    user_agent: userAgent,
    cookies: cookieMap,
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
  try {
    const r = await fetch(
      'http://api.nocaptcha.io/api/wanda/perimeterx/universal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Token': token },
        body: JSON.stringify(body),
      },
    );
    const j = (await r.json()) as any;
    if (j?.status !== 1) {
      console.log(
        `[captcha:api] nocaptcha PerimeterX err status=${j?.status} msg=${j?.msg ?? j?.message ?? JSON.stringify(j)}`,
      );
      markAllProvidersFailed('perimeterx');
      return null;
    } // G8
    const out: Array<{
      name: string;
      value: string;
      domain: string;
      path: string;
    }> = [];
    const dot = u.hostname.startsWith('www.')
      ? u.hostname.slice(3)
      : '.' + u.hostname;
    for (const [name, value] of Object.entries(j.data?.cookies ?? {}))
      out.push({ name, value: String(value), domain: dot, path: '/' });
    console.log(
      `[captcha:solver] PerimeterX solved via nocaptcha (${out.length} cookies)`,
    );
    if (out.length) costTracker.recordCaptcha('nocaptcha', 'perimeterx');
    return out.length ? out : null;
  } catch (e: any) {
    console.log(`[captcha:api] nocaptcha PerimeterX fetch err: ${e.message}`);
    return null;
  }
}
